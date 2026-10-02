use serde_json::{json, Value};
use std::env;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

struct BridgeProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Drop for BridgeProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl BridgeProcess {
    fn start(app: &AppHandle) -> Result<Self, String> {
        let resource_root = resource_root(app)?;
        let script = bridge_script(app, &resource_root)?;
        let runtime = node_runtime(app, &resource_root);
        let mut command = Command::new(&runtime);
        command
            .arg(&script)
            .env("JIKEPO_RESOURCE_DIR", &resource_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }

        let mut child = command.spawn().map_err(|error| {
            format!(
                "即客破运行时启动失败（{}）：{}。请重新构建以打包 Node 运行时。",
                runtime.display(),
                error
            )
        })?;
        let stdin = child.stdin.take().ok_or_else(|| "无法连接即客破运行时输入".to_string())?;
        let stdout = child.stdout.take().ok_or_else(|| "无法连接即客破运行时输出".to_string())?;
        Ok(Self { child, stdin, stdout: BufReader::new(stdout) })
    }

    fn call(&mut self, method: &str, args: Value) -> Result<Value, String> {
        let request_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos()
            .to_string();
        let payload = json!({ "id": request_id, "method": method, "args": args });
        serde_json::to_writer(&mut self.stdin, &payload).map_err(|error| error.to_string())?;
        self.stdin.write_all(b"\n").map_err(|error| error.to_string())?;
        self.stdin.flush().map_err(|error| error.to_string())?;

        let mut line = String::new();
        let read = self.stdout.read_line(&mut line).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("即客破运行时已退出".to_string());
        }
        let response: Value = serde_json::from_str(line.trim()).map_err(|error| {
            format!("即客破运行时返回了无效数据：{}", error)
        })?;
        if response.get("id").and_then(Value::as_str) != Some(request_id.as_str()) {
            return Err("即客破运行时响应序号不匹配".to_string());
        }
        if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            Ok(response.get("result").cloned().unwrap_or(Value::Null))
        } else {
            Err(response
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("即客破调用失败")
                .to_string())
        }
    }
}

static BRIDGE: OnceLock<Mutex<Option<BridgeProcess>>> = OnceLock::new();

fn bridge_state() -> &'static Mutex<Option<BridgeProcess>> {
    BRIDGE.get_or_init(|| Mutex::new(None))
}

fn dev_resource_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("jikepo")
}

fn extract_backend_archive(app: &AppHandle, archive_path: &Path) -> Result<PathBuf, String> {
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位即客破缓存目录：{}", error))?
        .join("jikepo")
        .join("0.3.29");
    let marker = cache_root.join(".ready");
    if marker.is_file() && cache_root.join("bridge.cjs").is_file() {
        return Ok(cache_root);
    }

    let temp_root = cache_root.with_extension(format!("extracting-{}", std::process::id()));
    if temp_root.exists() {
        fs::remove_dir_all(&temp_root).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&temp_root).map_err(|error| error.to_string())?;

    let archive_file = File::open(archive_path)
        .map_err(|error| format!("无法打开即客破资源包：{}", error))?;
    let mut archive = zip::ZipArchive::new(archive_file)
        .map_err(|error| format!("即客破资源包格式错误：{}", error))?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| format!("即客破资源包包含不安全路径：{}", entry.name()))?
            .to_path_buf();
        let destination = temp_root.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output = File::create(&destination).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&destination, fs::Permissions::from_mode(mode))
                .map_err(|error| error.to_string())?;
        }
    }
    fs::write(temp_root.join(".ready"), b"0.3.29\n")
        .map_err(|error| error.to_string())?;
    if cache_root.exists() {
        fs::remove_dir_all(&cache_root).map_err(|error| error.to_string())?;
    }
    if let Some(parent) = cache_root.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_root, &cache_root).map_err(|error| error.to_string())?;
    Ok(cache_root)
}

fn resource_root(app: &AppHandle) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位应用资源目录：{}", error))?
        .join("jikepo");
    if packaged.join("bridge.cjs").is_file() {
        return Ok(packaged);
    }
    let archive = packaged.join("jikepo-backend.zip");
    if archive.is_file() {
        return extract_backend_archive(app, &archive);
    }
    let dev = dev_resource_root();
    if dev.join("bridge.cjs").is_file() {
        Ok(dev)
    } else {
        Err(format!("即客破资源不完整：{}", packaged.display()))
    }
}

fn bridge_script(_app: &AppHandle, root: &Path) -> Result<PathBuf, String> {
    let script = root.join("bridge.cjs");
    if script.is_file() {
        Ok(script)
    } else {
        Err(format!("找不到即客破桥接脚本：{}", script.display()))
    }
}

fn node_runtime(app: &AppHandle, root: &Path) -> PathBuf {
    if let Some(value) = env::var_os("JIKEPO_NODE") {
        return PathBuf::from(value);
    }
    let name = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
    let local = root.join("runtime").join(name);
    if local.is_file() {
        return local;
    }
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("jikepo").join("runtime").join(name);
        if bundled.is_file() {
            return bundled;
        }
    }
    PathBuf::from(name)
}

#[tauri::command]
pub fn jikepo_call(app: AppHandle, method: String, args: Value) -> Result<Value, String> {
    let state = bridge_state();
    let mut guard = state.lock().map_err(|_| "即客破运行时锁已损坏".to_string())?;
    if guard.is_none() {
        *guard = Some(BridgeProcess::start(&app)?);
    }

    let first = guard.as_mut().expect("bridge initialized").call(&method, args.clone());
    let should_restart = first.as_ref().err().is_some_and(|error| {
        error == "即客破运行时已退出"
            || error.contains("Broken pipe")
            || error.contains("broken pipe")
            || error.contains("管道")
    });
    if !should_restart {
        return first;
    }

    // Only transport failures are retried. Business errors are never replayed,
    // so a partially completed file operation cannot run twice.
    *guard = Some(BridgeProcess::start(&app)?);
    guard.as_mut().expect("bridge restarted").call(&method, args)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySelection {
    canceled: bool,
    path: Option<String>,
}

#[tauri::command]
pub fn jikepo_select_directory(seat: String) -> Result<DirectorySelection, String> {
    let title = if seat.trim().is_empty() {
        "选择配置目录".to_string()
    } else {
        format!("选择 {} 的配置目录", seat)
    };
    let selected = rfd::FileDialog::new().set_title(&title).pick_folder();
    Ok(match selected {
        Some(path) => DirectorySelection {
            canceled: false,
            path: Some(path.to_string_lossy().to_string()),
        },
        None => DirectorySelection { canceled: true, path: None },
    })
}
