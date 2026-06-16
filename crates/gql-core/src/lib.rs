//! WASM GraphQL core for the playground.
//!
//! The browser talks to this crate over a JSON-string boundary: every exported
//! function takes JSON in and returns a JSON envelope out. Nothing here panics
//! on bad input — malformed schemas and queries are *normal* outcomes reported
//! as error envelopes, not exceptions (see the design doc, section 2).
//!
//! Internal logic lives in the sibling modules as plain Rust returning
//! `serde_json::Value`; the `#[wasm_bindgen]` functions below are thin wrappers
//! that parse input and stringify output, so native `cargo test` can exercise
//! the real logic without a browser.

mod api_schema;
mod compose;
mod dto;
mod mock;
mod plan;
mod validate;

use wasm_bindgen::prelude::*;

use crate::dto::SubgraphInput;

/// Install a panic hook so any (unexpected) Rust panic surfaces in the browser
/// console instead of an opaque `unreachable` trap. Last-resort net only.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Validate one subgraph SDL. Returns `{ diagnostics: [...] }`.
#[wasm_bindgen]
pub fn validate_subgraph(sdl: &str) -> String {
    validate::validate_subgraph(sdl).to_string()
}

/// Compose subgraphs into a supergraph.
///
/// Input: JSON array of `{ name, sdl }`.
/// Output: `{ ok: true, supergraph_sdl, hints }` or `{ ok: false, errors }`.
#[wasm_bindgen]
pub fn compose(subgraphs_json: &str) -> String {
    let subgraphs: Vec<SubgraphInput> = match serde_json::from_str(subgraphs_json) {
        Ok(parsed) => parsed,
        Err(err) => {
            return serde_json::json!({
                "ok": false,
                "errors": [{ "code": "BAD_INPUT", "message": err.to_string() }],
            })
            .to_string();
        }
    };
    compose::compose(&subgraphs).to_string()
}

/// Validate an operation against the composed API schema.
#[wasm_bindgen]
pub fn validate_query(supergraph_sdl: &str, operation: &str) -> String {
    validate::validate_query(supergraph_sdl, operation).to_string()
}

/// Produce the query plan for an operation (view-only; not used by execution).
#[wasm_bindgen]
pub fn plan(supergraph_sdl: &str, operation: &str, op_name: Option<String>) -> String {
    plan::plan(supergraph_sdl, operation, op_name.as_deref()).to_string()
}

/// Mock-execute an operation against the composed API schema. Deterministic in
/// `seed`: same schema + operation + seed yields identical data. Variables are
/// auto-generated from the operation's declared variable definitions.
#[wasm_bindgen]
pub fn execute_mock(supergraph_sdl: &str, operation: &str, seed: u64) -> String {
    mock::execute_mock(supergraph_sdl, operation, seed).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_returns_envelope_for_empty_input() {
        let out = compose("[]");
        let val: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(val.get("ok").is_some());
    }

    #[test]
    fn compose_rejects_malformed_input_without_panicking() {
        let out = compose("not json");
        assert!(out.contains("BAD_INPUT"));
    }
}
