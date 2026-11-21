use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RequestError {
    AlreadyInitialized  = 1,
    Unauthorized        = 2,
    NotFound            = 3,
    AlreadyPaid         = 4,
    AlreadyExpired      = 5,
    AlreadyCancelled    = 6,
    RequestIsExpired    = 7,
    NotExpiredYet       = 8,
    UnauthorizedPayer   = 9,
    InvalidAmount       = 10,
    InvalidTtl          = 11,
    CannotRenewActive   = 12,
    NotInitialized      = 13,
}
