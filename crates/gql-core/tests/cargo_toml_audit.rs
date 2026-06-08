//! Audit tests: verify Cargo.toml and .cargo/config.toml changes stay scoped to the task.

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
        if trimmed.starts_with('[') && !trimmed.starts_with("[package") && in_deps {
            break;
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

/// AC #2: .cargo/config.toml scopes the getrandom flag to wasm32 using a valid key.
/// The table header must be [target.'cfg(target_arch = "wasm32")'] with rustflags
/// directly under it — no .build sub-key.
#[test]
fn config_toml_has_valid_wasm32_target_header() {
    let content =
        fs::read_to_string("../../.cargo/config.toml").expect(".cargo/config.toml readable");

    // The invalid form contains '.build]' in the target header.
    assert!(
        !content.contains(r#"[target.'cfg(target_arch = "wasm32")'.build]"#),
        ".cargo/config.toml must NOT use [target.'cfg(target_arch = \"wasm32\")'.build] \
         — '.build' is not a valid sub-key under [target.*]. \
         AC #2 requires the header to be [target.'cfg(target_arch = \"wasm32\")'] with rustflags directly beneath."
    );

    // The correct form must be present.
    assert!(
        content.contains(r#"[target.'cfg(target_arch = "wasm32")']"#),
        ".cargo/config.toml must contain [target.'cfg(target_arch = \"wasm32\")'] as a table header."
    );

    // The rustflags line must appear after the correct header.
    let lines: Vec<&str> = content.lines().collect();
    let mut found_header = false;
    for (i, line) in lines.iter().enumerate() {
        if line.trim() == r#"[target.'cfg(target_arch = "wasm32")']"# {
            found_header = true;
            // Next non-empty, non-comment line should be rustflags.
            for next in lines.iter().skip(i + 1).map(|s| s.trim()) {
                if next.is_empty() || next.starts_with('#') {
                    continue;
                }
                assert!(
                    next.starts_with("rustflags"),
                    "After [target.'cfg(target_arch = \"wasm32\")'], the first non-empty \
                     line should be 'rustflags = ...' but got: {next:?}"
                );
                break;
            }
        }
    }
    assert!(
        found_header,
        "Missing [target.'cfg(target_arch = \"wasm32\")'] header in config.toml"
    );
}
