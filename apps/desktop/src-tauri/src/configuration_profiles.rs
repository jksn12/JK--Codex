use crate::error::{CodexxError, Result};
use crate::failover::{self, FailoverSettings};
use crate::providers::{
    activate_saved_provider_inner, detected_live_custom_provider,
    official_profiles::switch_official_profile_inner, open_store,
    remember_active_provider_on_connection, switch_provider_inner, ProviderInput, SavedProvider,
};
use crate::skills_mcp::{build_skills_mcp_state_inner, toggle_codex_mcp_inner, toggle_codex_skill_inner};
use crate::state::build_state_after_migration;
use crate::{disable_instruction_inner, enable_instruction_inner, enable_saved_prompt_inner};
use chrono::Local;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigurationProfileSummary {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigurationProfileSnapshot {
    provider_id: Option<String>,
    provider_snapshot: Option<SavedProvider>,
    failover_settings: FailoverSettings,
    prompt_kind: Option<String>,
    prompt_id: Option<String>,
    prompt_injection_mode: Option<String>,
    skill_ids: Vec<String>,
    mcp_ids: Vec<String>,
}

fn directory_key(config_dir: Option<String>) -> Result<(String, Option<String>)> {
    let dir = crate::resolve_codex_dir(config_dir)?;
    let key = dir.to_string_lossy().to_string();
    Ok((key, Some(dir.to_string_lossy().to_string())))
}

fn now() -> String {
    Local::now().to_rfc3339()
}

fn row_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConfigurationProfileSummary> {
    Ok(ConfigurationProfileSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        updated_at: row.get(2)?,
    })
}

fn list_by_key(key: &str) -> Result<Vec<ConfigurationProfileSummary>> {
    let conn = crate::app_db::open()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, updated_at
             FROM configuration_profiles
             WHERE codex_dir = ?1
             ORDER BY updated_at DESC, name COLLATE NOCASE ASC",
        )
        .map_err(|e| CodexxError::Database(e.to_string()))?;
    let rows = stmt
        .query_map([key], row_summary)
        .map_err(|e| CodexxError::Database(e.to_string()))?;
    rows.map(|row| row.map_err(|e| CodexxError::Database(e.to_string())))
        .collect()
}

fn snapshot_current(config_dir: Option<String>) -> Result<ConfigurationProfileSnapshot> {
    let dir = crate::resolve_codex_dir(config_dir.clone())?;
    let state = build_state_after_migration(dir.clone())?;
    let provider_id = if state.is_official_provider {
        Some(format!(
            "official:{}",
            state
                .active_official_profile_id
                .as_deref()
                .unwrap_or("openai-official"),
        ))
    } else {
        state.active_saved_provider_id.clone()
    };
    let provider_snapshot = if state.is_official_provider {
        None
    } else {
        detected_live_custom_provider(&dir)?
    };
    let failover_settings = failover::get_status(config_dir.clone())?.settings;
    let (prompt_kind, prompt_id) = state
        .instruction_template_key
        .as_deref()
        .and_then(|key| key.split_once(':'))
        .map(|(kind, id)| (Some(kind.to_string()), Some(id.to_string())))
        .unwrap_or((None, None));
    let skills_mcp = build_skills_mcp_state_inner(config_dir)?;
    Ok(ConfigurationProfileSnapshot {
        provider_id,
        provider_snapshot,
        failover_settings,
        prompt_kind,
        prompt_id,
        prompt_injection_mode: state.instruction_injection_mode,
        skill_ids: skills_mcp
            .skills
            .into_iter()
            .filter(|item| item.enabled)
            .map(|item| item.id)
            .collect(),
        mcp_ids: skills_mcp
            .mcp_servers
            .into_iter()
            .filter(|item| item.enabled)
            .map(|item| item.id)
            .collect(),
    })
}

pub(crate) fn list_configuration_profiles_inner(
    config_dir: Option<String>,
) -> Result<Vec<ConfigurationProfileSummary>> {
    let (key, _) = directory_key(config_dir)?;
    list_by_key(&key)
}

pub(crate) fn save_configuration_profile_inner(
    config_dir: Option<String>,
    profile_id: Option<String>,
    name: String,
) -> Result<Vec<ConfigurationProfileSummary>> {
    let (key, dir) = directory_key(config_dir.clone())?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(CodexxError::Config("配置方案名称不能为空".into()));
    }
    if name.len() > 120 {
        return Err(CodexxError::Config("配置方案名称不能超过 120 个字符".into()));
    }
    let snapshot = snapshot_current(dir.clone())?;
    let json = serde_json::to_string(&snapshot)
        .map_err(|e| CodexxError::Database(format!("配置方案序列化失败: {e}")))?;
    let id = profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("profile-{}", Local::now().timestamp_nanos_opt().unwrap_or_default()));
    let timestamp = now();
    let conn = crate::app_db::open()?;
    conn.execute(
        "INSERT INTO configuration_profiles (id, codex_dir, name, snapshot_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(id) DO UPDATE SET
           codex_dir = excluded.codex_dir,
           name = excluded.name,
           snapshot_json = excluded.snapshot_json,
           updated_at = excluded.updated_at",
        params![id, key, name, json, timestamp],
    )
    .map_err(|e| CodexxError::Database(e.to_string()))?;
    list_by_key(&key)
}

fn load_snapshot(key: &str, profile_id: &str) -> Result<ConfigurationProfileSnapshot> {
    let conn = crate::app_db::open()?;
    let json: Option<String> = conn
        .query_row(
            "SELECT snapshot_json FROM configuration_profiles WHERE id = ?1 AND codex_dir = ?2",
            params![profile_id, key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| CodexxError::Database(e.to_string()))?;
    let json = json.ok_or_else(|| CodexxError::Config("配置方案不存在，可能已被删除".into()))?;
    serde_json::from_str(&json)
        .map_err(|e| CodexxError::Database(format!("配置方案数据损坏: {e}")))
}

fn apply_prompt(config_dir: Option<String>, snapshot: &ConfigurationProfileSnapshot) -> Result<()> {
    let mode = snapshot.prompt_injection_mode.clone();
    match (snapshot.prompt_kind.as_deref(), snapshot.prompt_id.as_deref()) {
        (Some("builtin"), Some(id)) => {
            enable_instruction_inner(config_dir, id, mode)?;
        }
        (Some("saved"), Some(id)) => {
            enable_saved_prompt_inner(config_dir, id.to_string(), mode)?;
        }
        _ => {
            disable_instruction_inner(config_dir, Some(false))?;
        }
    }
    Ok(())
}

fn apply_skills_mcp(config_dir: Option<String>, snapshot: &ConfigurationProfileSnapshot) -> Result<()> {
    let desired_skills: HashSet<&str> = snapshot.skill_ids.iter().map(String::as_str).collect();
    let desired_mcp: HashSet<&str> = snapshot.mcp_ids.iter().map(String::as_str).collect();
    let current = build_skills_mcp_state_inner(config_dir.clone())?;
    for skill in current.skills {
        let should_enable = desired_skills.contains(skill.id.as_str());
        if skill.enabled != should_enable {
            toggle_codex_skill_inner(config_dir.clone(), skill.id, should_enable)?;
        }
    }
    for server in current.mcp_servers {
        let should_enable = desired_mcp.contains(server.id.as_str());
        if server.enabled != should_enable {
            toggle_codex_mcp_inner(config_dir.clone(), server.id, should_enable)?;
        }
    }
    Ok(())
}

fn apply_provider_snapshot(config_dir: Option<String>, provider: SavedProvider) -> Result<()> {
    switch_provider_inner(ProviderInput {
        config_dir,
        provider_id: Some(provider.id),
        provider_name: provider.provider_name,
        base_url: provider.base_url,
        model: provider.model,
        api_key: provider.api_key,
        wire_api: Some(provider.wire_api),
        requires_openai_auth: Some(provider.requires_openai_auth),
    })?;
    Ok(())
}

pub(crate) fn apply_configuration_profile_inner(
    config_dir: Option<String>,
    profile_id: String,
) -> Result<Vec<ConfigurationProfileSummary>> {
    let (key, dir) = directory_key(config_dir.clone())?;
    let snapshot = load_snapshot(&key, profile_id.trim())?;
    if snapshot.provider_id.is_some() || snapshot.provider_snapshot.is_some() {
        let selected_dir = dir.clone();
        let provider_id = snapshot.provider_id.clone();
        let provider_snapshot = snapshot.provider_snapshot.clone();
        failover::with_provider_change(dir.clone(), || {
            if let Some(provider_id) = provider_id.as_deref() {
                if let Some(official_id) = provider_id.strip_prefix("official:") {
                    switch_official_profile_inner(selected_dir.clone(), official_id.to_string())?;
                } else {
                    match activate_saved_provider_inner(selected_dir.clone(), provider_id.to_string()) {
                        Ok(_) => {
                            let resolved = crate::resolve_codex_dir(selected_dir.clone())?;
                            remember_active_provider_on_connection(&open_store()?, &resolved, provider_id)?;
                        }
                        Err(error) if provider_snapshot.is_some() => {
                            apply_provider_snapshot(selected_dir.clone(), provider_snapshot.clone().unwrap())?;
                            let _ = error;
                        }
                        Err(error) => return Err(error),
                    }
                }
            } else if let Some(provider) = provider_snapshot {
                apply_provider_snapshot(selected_dir.clone(), provider)?;
            }
            Ok(())
        })?;
    }
    failover::save_settings(dir.clone(), snapshot.failover_settings.clone())?;
    apply_prompt(dir.clone(), &snapshot)?;
    apply_skills_mcp(dir, &snapshot)?;
    list_by_key(&key)
}

pub(crate) fn delete_configuration_profile_inner(
    config_dir: Option<String>,
    profile_id: String,
) -> Result<Vec<ConfigurationProfileSummary>> {
    let (key, _) = directory_key(config_dir)?;
    let conn = crate::app_db::open()?;
    let deleted = conn
        .execute(
            "DELETE FROM configuration_profiles WHERE id = ?1 AND codex_dir = ?2",
            params![profile_id.trim(), key],
        )
        .map_err(|e| CodexxError::Database(e.to_string()))?;
    if deleted == 0 {
        return Err(CodexxError::Config("配置方案不存在，可能已被删除".into()));
    }
    list_by_key(&key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn profile_round_trip_restores_provider_skills_and_mcp_then_deletes_cleanly() {
        let _guard = crate::app_db::test_db_guard();
        let suffix = format!(
            "{}-{}",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let codex_dir = std::env::temp_dir().join(format!("jike-profile-{suffix}"));
        let skill_id = format!("profile-skill-{suffix}");
        let mcp_id = format!("profile-mcp-{suffix}");
        let profile_name = format!("Profile {suffix}");
        fs::create_dir_all(codex_dir.join("skills").join(&skill_id)).unwrap();
        fs::write(
            codex_dir.join("skills").join(&skill_id).join("SKILL.md"),
            format!("---\nname: {skill_id}\ndescription: profile test\n---\n"),
        )
        .unwrap();
        fs::write(
            codex_dir.join("config.toml"),
            format!(
                "model_provider = \"custom\"\nmodel = \"profile-model\"\n\n\
                 [model_providers.custom]\nname = \"Profile Provider\"\nbase_url = \"https://profile.invalid/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = false\n\n\
                 [mcp_servers.\"{mcp_id}\"]\ncommand = \"profile-server\"\nenabled = true\n"
            ),
        )
        .unwrap();
        let scope = Some(codex_dir.display().to_string());

        let saved = save_configuration_profile_inner(scope.clone(), None, profile_name.clone())
            .expect("save profile");
        let profile = saved
            .iter()
            .find(|profile| profile.name == profile_name)
            .expect("saved profile summary")
            .clone();

        toggle_codex_skill_inner(scope.clone(), skill_id.clone(), false)
            .expect("disable skill before apply");
        toggle_codex_mcp_inner(scope.clone(), mcp_id.clone(), false)
            .expect("disable MCP before apply");
        fs::write(
            codex_dir.join("config.toml"),
            "model_provider = \"other\"\nmodel = \"changed\"\n\n[model_providers.other]\nname = \"Changed\"\nbase_url = \"https://changed.invalid/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = false\n",
        )
        .unwrap();

        apply_configuration_profile_inner(scope.clone(), profile.id.clone())
            .expect("apply profile");
        let restored = build_state_after_migration(codex_dir.clone()).expect("read restored state");
        assert_eq!(restored.model.as_deref(), Some("profile-model"));
        assert_eq!(restored.model_provider.as_deref(), Some("custom"));
        let skills_mcp = build_skills_mcp_state_inner(scope.clone()).expect("read skills and MCP");
        assert!(skills_mcp
            .skills
            .iter()
            .any(|skill| skill.id == skill_id && skill.enabled));
        assert!(skills_mcp
            .mcp_servers
            .iter()
            .any(|server| server.id == mcp_id && server.enabled));

        let remaining = delete_configuration_profile_inner(scope, profile.id).expect("delete profile");
        assert!(!remaining.iter().any(|item| item.name == profile_name));
        let _ = fs::remove_dir_all(codex_dir);
    }
}
