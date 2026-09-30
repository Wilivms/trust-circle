//! Tontine Monde — tontine familiale multi-devises sur Stellar.
//!
//! Le contrat ne manipule qu'un seul actif : l'USDC (via son Stellar Asset
//! Contract), qui sert d'unité de compte. Chaque membre verse `amount` USDC
//! par tour ; quand tout le monde a cotisé, `payout` verse la cagnotte au
//! bénéficiaire du tour (rotation dans l'ordre de `members`).
//!
//! La conversion devise locale <-> USDC se fait en dehors du contrat, avec
//! les path payments natifs de Stellar : chacun verse donc exactement la même
//! valeur, au taux du marché au moment du paiement.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, Vec,
};

/// ~30 jours de ledgers (5 s par ledger) : on garde l'état vivant pendant la tontine.
const TTL_THRESHOLD: u32 = 17_280 * 7;
const TTL_EXTEND_TO: u32 = 17_280 * 30;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Token,
    Members,
    Amount,
    Round,
    Paid,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotMember = 1,
    AlreadyPaid = 2,
    NotAllPaid = 3,
    Finished = 4,
}

/// Vue complète de la tontine, pour le front.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct State {
    pub token: Address,
    pub members: Vec<Address>,
    pub amount: i128,
    pub round: u32,
    pub total_rounds: u32,
    pub paid: Vec<Address>,
    pub pot: i128,
    pub beneficiary: Option<Address>,
    pub finished: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Contributed {
    #[topic]
    pub member: Address,
    pub round: u32,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaidOut {
    #[topic]
    pub beneficiary: Address,
    pub round: u32,
    pub amount: i128,
}

#[contract]
pub struct Tontine;

#[contractimpl]
impl Tontine {
    /// Appelé une seule fois au déploiement.
    pub fn __constructor(env: Env, token: Address, members: Vec<Address>, amount: i128) {
        if members.is_empty() {
            panic!("au moins un membre");
        }
        if amount <= 0 {
            panic!("montant invalide");
        }
        // Pas de doublons dans la liste des membres.
        for i in 0..members.len() {
            for j in (i + 1)..members.len() {
                if members.get_unchecked(i) == members.get_unchecked(j) {
                    panic!("membre en double");
                }
            }
        }
        let s = env.storage().instance();
        s.set(&DataKey::Token, &token);
        s.set(&DataKey::Members, &members);
        s.set(&DataKey::Amount, &amount);
        s.set(&DataKey::Round, &0u32);
        s.set(&DataKey::Paid, &Vec::<Address>::new(&env));
        bump(&env);
    }

    /// Le membre verse sa cotisation du tour (en USDC).
    pub fn contribute(env: Env, member: Address) -> Result<(), Error> {
        member.require_auth();
        bump(&env);

        let members = members(&env);
        let round = round(&env);
        if round >= members.len() {
            return Err(Error::Finished);
        }
        if !members.contains(&member) {
            return Err(Error::NotMember);
        }
        let mut paid = paid(&env);
        if paid.contains(&member) {
            return Err(Error::AlreadyPaid);
        }

        let amount = amount(&env);
        token::Client::new(&env, &token(&env)).transfer(
            &member,
            &env.current_contract_address(),
            &amount,
        );

        paid.push_back(member.clone());
        env.storage().instance().set(&DataKey::Paid, &paid);
        Contributed { member, round, amount }.publish(&env);
        Ok(())
    }

    /// Verse la cagnotte au bénéficiaire du tour une fois que tout le monde a
    /// cotisé. N'importe qui peut déclencher le versement.
    pub fn payout(env: Env) -> Result<Address, Error> {
        bump(&env);

        let members = members(&env);
        let round = round(&env);
        if round >= members.len() {
            return Err(Error::Finished);
        }
        if paid(&env).len() != members.len() {
            return Err(Error::NotAllPaid);
        }

        let beneficiary = members.get_unchecked(round);
        let pot = amount(&env) * members.len() as i128;
        token::Client::new(&env, &token(&env)).transfer(
            &env.current_contract_address(),
            &beneficiary,
            &pot,
        );

        let s = env.storage().instance();
        s.set(&DataKey::Round, &(round + 1));
        s.set(&DataKey::Paid, &Vec::<Address>::new(&env));
        PaidOut { beneficiary: beneficiary.clone(), round, amount: pot }.publish(&env);
        Ok(beneficiary)
    }

    pub fn get_state(env: Env) -> State {
        let members = members(&env);
        let round = round(&env);
        let total_rounds = members.len();
        let paid = paid(&env);
        let amount = amount(&env);
        let finished = round >= total_rounds;
        State {
            token: token(&env),
            beneficiary: if finished { None } else { Some(members.get_unchecked(round)) },
            pot: amount * paid.len() as i128,
            members,
            amount,
            round,
            total_rounds,
            paid,
            finished,
        }
    }
}

fn bump(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}
fn token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}
fn members(env: &Env) -> Vec<Address> {
    env.storage().instance().get(&DataKey::Members).unwrap()
}
fn amount(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::Amount).unwrap()
}
fn round(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::Round).unwrap()
}
fn paid(env: &Env) -> Vec<Address> {
    env.storage().instance().get(&DataKey::Paid).unwrap()
}

#[cfg(test)]
mod test;
