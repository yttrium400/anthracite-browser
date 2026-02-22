#![deny(clippy::all)]

use napi_derive::napi;
use serde_json::Value;

#[napi]
pub fn scrub_ads_native(mut json_string: String) -> String {
    let mut parsed: Value = match serde_json::from_str(&json_string) {
        Ok(v) => v,
        Err(_) => return json_string, // Failed to parse, return original
    };

    if scrub_ads(&mut parsed) {
        // Only re-serialize if changes were made
        match serde_json::to_string(&parsed) {
            Ok(s) => return s,
            Err(_) => return json_string,
        }
    }

    json_string
}

fn scrub_ads(value: &mut Value) -> bool {
    let mut changed = false;

    match value {
        Value::Object(map) => {
            // Check common ad arrays
            let ad_keys = ["adPlacements", "playerAds", "adSlots"];
            
            for key in ad_keys.iter() {
                if let Some(val) = map.get_mut(*key) {
                    if val.is_array() {
                        let arr = val.as_array_mut().unwrap();
                        if !arr.is_empty() {
                            arr.clear();
                            changed = true;
                        }
                    } else {
                        // If it exists but isn't an array, we just remove it
                        map.remove(*key);
                        changed = true;
                    }
                }
            }

            // Recurse into children
            for (_, val) in map.iter_mut() {
                if scrub_ads(val) {
                    changed = true;
                }
            }
        }
        Value::Array(arr) => {
            for val in arr.iter_mut() {
                if scrub_ads(val) {
                    changed = true;
                }
            }
        }
        _ => {}
    }

    changed
}
