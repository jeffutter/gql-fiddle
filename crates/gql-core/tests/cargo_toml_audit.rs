//! Audit tests: verify Cargo.toml changes stay scoped to the task.

use std::collections::{BTreeMap, HashSet};
use std::fs;

/// Parse a TOML file and return its [dependencies] section as a map of
/// dependency name → inline table string (the full value).
fn read_dependencies(path: &str) -> BTreeMap<String, String> {
    let content = fs::read_to_string(path).expect("Cargo.toml readable");
    let mut in_deps = false;
    let mut deps = BTreeMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "[dependencies]" {
            in_deps = true;
            continue;
        }
        if trimmed.starts_with('[') && !trimmed.starts_with("[package") {
            // Hit a new section that is NOT [package.metadata...]
            if in_deps {
                break;
            }
        }
        if in_deps && trimmed.starts_with('#') {
            continue; // skip comments within the section
        }
        if in_deps && !trimmed.is_empty() && !trimmed.starts_with('#') {
            // Parse key = value
            if let Some(eq_pos) = trimmed.find('=') {
                let key = trimmed[..eq_pos].trim().to_string();
                let value = trimmed[eq_pos..].trim().to_string();
                deps.insert(key, value);
            }
        }
    }

    deps
}

/// Get the committed version of Cargo.toml via `git show HEAD`.
fn read_committed_dependencies() -> BTreeMap<String, String> {
    let output = std::process::Command::new("git")
        .args(["show", "HEAD:crates/gql-core/Cargo.toml"])
        .output()
        .expect("git show succeeded");

    let content = String::from_utf8(output.stdout).expect("valid UTF-8");
    let mut in_deps = false;
    let mut deps = BTreeMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "[dependencies]" {
            in_deps = true;
            continue;
        }
        if trimmed.starts_with('[') && !trimmed.starts_with("[package") {
            if in_deps {
                break;
            }
        }
        if in_deps && trimmed.starts_with('#') {
            continue;
        }
        if in_deps && !trimmed.is_empty() && !trimmed.starts_with('#') {
            if let Some(eq_pos) = trimmed.find('=') {
                let key = trimmed[..eq_pos].trim().to_string();
                let value = trimmed[eq_pos..].trim().to_string();
                deps.insert(key, value);
            }
        }
    }

    deps
}

#[test]
fn getrandom_is_the_only_dependency_change() {
    let committed = read_committed_dependencies();
    let working = read_dependencies("Cargo.toml");

    // Collect all dependency names that differ (added, removed, or modified).
    let mut changed: HashSet<String> = HashSet::new();

    // Check for added or modified deps.
    for (key, value) in &working {
        match committed.get(key) {
            Some(committed_value) if committed_value != value => {
                changed.insert(key.clone());
            }
            None => {
                changed.insert(key.clone());
            }
            Some(_) => {} // unchanged
        }
    }

    // Check for removed deps.
    for key in committed.keys() {
        if !working.contains_key(key) {
            changed.insert(key.clone());
        }
    }

    // The only allowed change is getrandom.
    let unexpected: Vec<&String> = changed.iter().filter(|k| **k != "getrandom").collect();
    assert!(
        unexpected.is_empty(),
        "Unexpected dependency changes beyond 'getrandom': {:?}\n\ntask AC #3 requires \
         that the getrandom line is the ONLY dependency change made.",
        unexpected
    );
}
