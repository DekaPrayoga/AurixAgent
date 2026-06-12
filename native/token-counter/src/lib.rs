use napi::bindgen_prelude::*;
use napi_derive::napi;
use tiktoken_rs::{cl100k_base, o200k_base, CoreBPE};

fn get_encoding(name: Option<String>) -> Result<CoreBPE> {
    match name.as_deref().unwrap_or("cl100k_base") {
        "o200k_base" => o200k_base()
            .map_err(|e| Error::from_reason(format!("Failed to load o200k_base: {}", e))),
        _ => cl100k_base()
            .map_err(|e| Error::from_reason(format!("Failed to load cl100k_base: {}", e))),
    }
}

#[napi]
pub fn count_tokens(text: String, encoding: Option<String>) -> Result<u32> {
    let bpe = get_encoding(encoding)?;
    Ok(bpe.encode_ordinary(&text).len() as u32)
}

#[napi]
pub fn count_tokens_batch(texts: Vec<String>, encoding: Option<String>) -> Result<Vec<u32>> {
    let bpe = get_encoding(encoding)?;
    Ok(texts
        .iter()
        .map(|t| bpe.encode_ordinary(t).len() as u32)
        .collect())
}
