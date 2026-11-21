use soroban_sdk::Address;

pub trait EscrowPolicy { fn can_fund(&self, caller: &Address, amount: i128) -> bool; fn can_release(&self, caller: &Address) -> bool; }

pub struct ClientPolicy { pub client: Address }
impl EscrowPolicy for ClientPolicy { fn can_fund(&self, caller: &Address, amount: i128) -> bool { &self.client == caller && amount > 0 } fn can_release(&self, caller: &Address) -> bool { &self.client == caller } }
