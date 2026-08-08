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
//!
//! ## Envelope conventions
//!
//! The six exports below use three deliberately different failure shapes,
//! chosen per export based on whether callers need to *act* on a failure
//! (retry, surface an error) or just get an empty/best-effort result:
//!
//! 1. **Result envelope** ([`compose()`], [`plan()`]): `{ ok: true, ... }` on
//!    success, `{ ok: false, errors: [...] }` on failure. These are
//!    all-or-nothing operations — there's no partial result worth returning.
//! 2. **Diagnostics envelope** ([`validate_subgraph`], [`validate_query`]):
//!    `{ diagnostics: [...] }`, where an empty array means the input is
//!    valid and each entry carries a `(line, col, len)` position for editor
//!    underlining. [`validate_query`] additionally returns
//!    `{ schema_error: { message } }` when the fault is in the
//!    supergraph/schema rather than in the operation being validated (see
//!    `validate::validate_query` for why the two failure sources can't share
//!    one diagnostic shape). Callers MUST check for `schema_error` before
//!    treating the payload as query diagnostics.
//! 3. **Silent-default envelope** ([`query_shape()`]): return an empty/null
//!    result for invalid input rather than an error. This is a view-only
//!    convenience (editor tree), not a diagnostic surface, so there's nothing
//!    meaningful to report back to the caller.

mod api_schema;
mod compose;
mod dto;
mod mock;
mod plan;
mod query_shape;
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
///
/// Returns `{ schema_error: { message } }` if the supergraph/API schema
/// itself is unusable, or `{ diagnostics: [...] }` for the operation's own
/// diagnostics (empty array if valid). See the module-level "Envelope
/// conventions" doc and `validate::validate_query` for details.
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
///
/// `mock_config` is a JSON string mapping `"TypeName.fieldName"` keys to
/// override rules (`enum`, `unionType`, `value`, `null`). Pass `"{}"` for
/// default behaviour (no overrides).
#[wasm_bindgen]
pub fn execute_mock(supergraph_sdl: &str, operation: &str, seed: u64, mock_config: &str) -> String {
    mock::execute_mock(supergraph_sdl, operation, seed, mock_config).to_string()
}

/// Compute the query shape tree from an API schema SDL and a query string.
///
/// Returns `{ "operations": [] }` for empty, invalid SDL, or invalid query inputs.
#[wasm_bindgen]
pub fn query_shape(api_schema_sdl: &str, query: &str) -> String {
    query_shape::query_shape(api_schema_sdl, query).to_string()
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

#[cfg(test)]
mod debug_test {
    use apollo_compiler::Schema;

    #[test]
    fn debug_ranges() {
        let sdl = "type Q {\na: String\n}";
        let schema = Schema::builder()
            .adopt_orphan_extensions()
            .ignore_builtin_redefinitions()
            .parse(sdl, "<subgraph>")
            .build()
            .unwrap();
        let sources = &schema.sources;
        for (type_name, ext_type) in &schema.types {
            if ext_type.is_built_in() {
                continue;
            }
            if let apollo_compiler::schema::ExtendedType::Object(obj) = ext_type {
                for (field_name, fc) in &obj.fields {
                    if let Some(range) = fc.node.line_column_range(sources) {
                        eprintln!(
                            "Field '{}' on '{}': ({},{}) -> ({},{})",
                            field_name,
                            type_name,
                            range.start.line,
                            range.start.column,
                            range.end.line,
                            range.end.column
                        );
                    }
                }
                if let Some(range) = obj.line_column_range(sources) {
                    eprintln!(
                        "Type '{}': ({},{}) -> ({},{})",
                        type_name,
                        range.start.line,
                        range.start.column,
                        range.end.line,
                        range.end.column
                    );
                }
            }
        }
    }
}
