//! Audit tests: verify Cargo.toml and .cargo/config.toml changes stay scoped to the task.

use std::fs;

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
