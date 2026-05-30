use serde::Serialize;

#[derive(Clone, Debug)]
pub struct User {
    pub id: u64,
    pub name: String,
}

#[derive(Serialize)]
pub struct UserResponse {
    pub id: u64,
    pub name: String,
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            name: user.name,
        }
    }
}
