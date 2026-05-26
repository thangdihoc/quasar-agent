use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolParameter {
    #[serde(rename = "type")]
    pub param_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Box<ToolParameter>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<HashMap<String, ToolParameter>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: ToolParameter,
}

impl ToolDef {
    pub fn new(name: impl Into<String>, description: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            parameters: ToolParameter {
                param_type: "object".to_string(),
                description: None,
                items: None,
                properties: Some(HashMap::new()),
                required: Some(Vec::new()),
            },
        }
    }

    pub fn add_parameter(
        mut self,
        name: impl Into<String>,
        param_type: impl Into<String>,
        description: impl Into<String>,
        required: bool,
    ) -> Self {
        let name = name.into();
        if let Some(ref mut props) = self.parameters.properties {
            props.insert(
                name.clone(),
                ToolParameter {
                    param_type: param_type.into(),
                    description: Some(description.into()),
                    items: None,
                    properties: None,
                    required: None,
                },
            );
        }
        if required {
            if let Some(ref mut req) = self.parameters.required {
                req.push(name);
            }
        }
        self
    }
}

pub trait Tool: Send + Sync {
    fn definition(&self) -> ToolDef;
    fn execute(&self, args: Value) -> impl std::future::Future<Output = crate::QuasarResult<String>> + Send;
}
