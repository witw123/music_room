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
    concurrent_parts: Option<usize>,
) -> Result<NativeDownloadResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let parts = concurrent_parts.unwrap_or(4).clamp(1, 8);

    // 1. Probe using Range: bytes=0-0 to check Range support and total length without downloading whole file
    let mut probe_req = client.get(&url).header("Range", "bytes=0-0");
    if let Some(ref h) = headers {
        for (k, v) in h {
            if let (Ok(hn), Ok(hv)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(v),
            ) {
                probe_req = probe_req.header(hn, hv);
            }
        }
    }

    let probe_res = probe_req.send().await.map_err(|e| format!("Probe request failed: {e}"))?;
    let content_type = probe_res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let status = probe_res.status();

    // If server responded 206 Partial Content, parse Content-Range to find total size
    let mut total_length: Option<usize> = None;
    if status == reqwest::StatusCode::PARTIAL_CONTENT {
        if let Some(cr) = probe_res.headers().get("content-range").and_then(|v| v.to_str().ok()) {
            if let Some(slash_pos) = cr.rfind('/') {
                if let Ok(total) = cr[slash_pos + 1..].trim().parse::<usize>() {
                    total_length = Some(total);
                }
            }
        }
    }

    // If Range is supported and file is sufficiently large (> 256KB), perform parallel download
    if let Some(total) = total_length {
        if total >= 256 * 1024 && parts > 1 {
            let chunk_size = (total + parts - 1) / parts;
            let mut tasks = Vec::with_capacity(parts);

            for i in 0..parts {
                let start = i * chunk_size;
                let end = std::cmp::min(total - 1, start + chunk_size - 1);
                if start > end {
                    break;
                }
                let client = client.clone();
                let url = url.clone();
                let headers = headers.clone();

                tasks.push(tauri::async_runtime::spawn(async move {
                    let mut req = client.get(&url).header("Range", format!("bytes={start}-{end}"));
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
                    let res = req.send().await.map_err(|e| e.to_string())?;
                    if res.status() != reqwest::StatusCode::PARTIAL_CONTENT && res.status() != reqwest::StatusCode::OK {
                        return Err(format!("Range chunk [{start}-{end}] returned status {}", res.status()));
                    }
                    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
                    Ok(bytes)
                }));
            }

            let mut full_bytes = Vec::with_capacity(total);
            for task in tasks {
                let chunk = task.await.map_err(|e| format!("Task join failed: {e}"))??;
                full_bytes.extend_from_slice(&chunk);
            }

            let data_base64 = STANDARD.encode(&full_bytes);
            return Ok(NativeDownloadResponse {
                data_base64,
                content_type,
                content_length: full_bytes.len(),
            });
        }
    }

    // Fallback: standard single connection GET (if probe returned 200 OK or single part)
    let full_bytes = if status == reqwest::StatusCode::OK {
        probe_res.bytes().await.map_err(|e| format!("Failed to read body: {e}"))?
    } else {
        let mut full_req = client.get(&url);
        if let Some(ref h) = headers {
            for (k, v) in h {
                if let (Ok(hn), Ok(hv)) = (
                    reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                    reqwest::header::HeaderValue::from_str(v),
                ) {
                    full_req = full_req.header(hn, hv);
                }
            }
        }
        let res = full_req.send().await.map_err(|e| format!("Full request failed: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("Download failed with status: {}", res.status()));
        }
        res.bytes().await.map_err(|e| format!("Failed to read body: {e}"))?
    };

    let data_base64 = STANDARD.encode(&full_bytes);
    Ok(NativeDownloadResponse {
        data_base64,
        content_type,
        content_length: full_bytes.len(),
    })
}
