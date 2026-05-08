use serde::Serialize;
use std::{path::Path, process::Command};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitFileChange {
    status: String,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitCommit {
    hash: String,
    subject: String,
    author: String,
    date: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatus {
    is_repository: bool,
    branch: Option<String>,
    changes: Vec<GitFileChange>,
    current_file_diff: String,
    recent_commits: Vec<GitCommit>,
}

pub(crate) fn workspace_status(
    root: &Path,
    current_path: Option<&Path>,
) -> Result<GitStatus, String> {
    if !root.join(".git").exists() {
        return Ok(GitStatus {
            is_repository: false,
            branch: None,
            changes: Vec::new(),
            current_file_diff: String::new(),
            recent_commits: Vec::new(),
        });
    }

    let branch = git_output(root, &["branch", "--show-current"])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let changes = parse_status(&git_output(root, &["status", "--short"])?);
    let recent_commits = parse_log(&git_output(
        root,
        &[
            "log",
            "--date=short",
            "--pretty=format:%h%x1f%ad%x1f%an%x1f%s",
            "-n",
            "5",
        ],
    )?);
    let current_file_diff = current_path
        .and_then(|path| relative_to_root(root, path))
        .map(|relative| git_output(root, &["diff", "--", &relative]).unwrap_or_default())
        .unwrap_or_default();

    Ok(GitStatus {
        is_repository: true,
        branch,
        changes,
        current_file_diff,
        recent_commits,
    })
}

pub(crate) fn commit_workspace(root: &Path, message: &str) -> Result<GitStatus, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("提交信息不能为空。".to_string());
    }
    if !root.join(".git").exists() {
        return Err("当前工作区不是 Git 仓库。".to_string());
    }

    run_git(root, &["add", "-A"])?;
    run_git(root, &["commit", "-m", message])?;
    workspace_status(root, None)
}

fn relative_to_root(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

fn parse_status(output: &str) -> Vec<GitFileChange> {
    output
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            Some(GitFileChange {
                status: line[..2].trim().to_string(),
                path: line[3..].trim().to_string(),
            })
        })
        .collect()
}

fn parse_log(output: &str) -> Vec<GitCommit> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            Some(GitCommit {
                hash: parts.next()?.to_string(),
                date: parts.next()?.to_string(),
                author: parts.next()?.to_string(),
                subject: parts.next()?.to_string(),
            })
        })
        .collect()
}

fn git_output(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|error| format!("无法运行 git：{error}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("git 命令失败：{}", output.status)
    } else {
        format!("git 命令失败：{stderr}")
    })
}

fn run_git(root: &Path, args: &[&str]) -> Result<(), String> {
    git_output(root, args).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::{parse_log, parse_status};

    #[test]
    fn parses_short_status() {
        let changes = parse_status(" M notes/a.md\n?? daily/2026-05-07.md\n");
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].status, "M");
        assert_eq!(changes[1].path, "daily/2026-05-07.md");
    }

    #[test]
    fn parses_git_log() {
        let commits = parse_log("abc123\x1f2026-05-07\x1fAlice\x1fInitial commit\n");
        assert_eq!(commits[0].hash, "abc123");
        assert_eq!(commits[0].subject, "Initial commit");
    }
}
