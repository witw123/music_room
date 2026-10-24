use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDownloadResponse {
    pub data_base64: String,
    pub content_type: String,
    pub content_length: usize,
}

pub async fn download_direct_native(
    url: String,
    headers: Option<HashMap<String, String>>,
    _concurrent_parts: Option<usize>,
) -> Result<NativeDownloadResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let mut req = client.get(&url);
    if let Some(ref h) = headers {
        for (k, v) in h {
            if let (Ok(hn), Ok(hv)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(v),
            ) {
                req = req.header(hn, hv);
            }
        }
    }

    let res = req.send().await.map_err(|e| format!("Direct download request failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Download failed with status: {}", res.status()));
    }

    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let bytes = res.bytes().await.map_err(|e| format!("Failed to read response body: {e}"))?;
    let data_base64 = STANDARD.encode(&bytes);

    Ok(NativeDownloadResponse {
        data_base64,
        content_type,
        content_length: bytes.len(),
    })
}
