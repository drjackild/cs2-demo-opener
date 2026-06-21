use serde::Serialize;
use std::fmt;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(tag = "type", content = "message")]
pub enum AppError {
    Io(String),
    Registry(String),
    Parser(String),
    Launch(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Io(s) => write!(f, "IO Error: {}", s),
            AppError::Registry(s) => write!(f, "Registry Error: {}", s),
            AppError::Parser(s) => write!(f, "Parser Error: {}", s),
            AppError::Launch(s) => write!(f, "Launch Error: {}", s),
        }
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}
