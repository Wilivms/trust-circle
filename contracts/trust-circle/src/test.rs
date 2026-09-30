#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, token::TokenClient, vec};

const AMOUNT: i128 = 100_0000000; // 100 USDC (7 décimales)

struct Setup<'a> {
    env: Env,
    usdc: TokenClient<'a>,
    members: Vec<Address>,
    client: TrustCircleClient<'a>,
}

fn setup() -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let usdc = TokenClient::new(&env, &sac.address());
    let minter = StellarAssetClient::new(&env, &sac.address());

    let members = vec![
        &env,
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    for m in members.iter() {
        minter.mint(&m, &(AMOUNT * 10));
    }

    let id = env.register(TrustCircle, (sac.address(), members.clone(), AMOUNT));
    let client = TrustCircleClient::new(&env, &id);
    Setup { env, usdc, members, client }
}

#[test]
fn full_rotation() {
    let s = setup();
    let n = s.members.len();

    for round in 0..n {
        let st = s.client.get_state();
        assert_eq!(st.round, round);
        assert_eq!(st.beneficiary, Some(s.members.get(round).unwrap()));

        for m in s.members.iter() {
            s.client.contribute(&m);
        }
        assert_eq!(s.client.get_state().pot, AMOUNT * n as i128);
        assert_eq!(s.usdc.balance(&s.client.address), AMOUNT * n as i128);

        let b = s.client.payout();
        assert_eq!(b, s.members.get(round).unwrap());
        assert_eq!(s.usdc.balance(&s.client.address), 0);
    }

    // Tout le monde a versé 5 x 100 et reçu 500 : solde inchangé.
    for m in s.members.iter() {
        assert_eq!(s.usdc.balance(&m), AMOUNT * 10);
    }
    let st = s.client.get_state();
    assert!(st.finished);
    assert_eq!(st.beneficiary, None);
    assert_eq!(s.client.try_contribute(&s.members.get(0).unwrap()), Err(Ok(Error::Finished)));
    assert_eq!(s.client.try_payout(), Err(Ok(Error::Finished)));
}

#[test]
fn requires_member_auth() {
    let s = setup();
    let m = s.members.get(2).unwrap();
    s.client.contribute(&m);
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, m);
}

#[test]
fn rejects_double_payment_and_outsiders() {
    let s = setup();
    let m = s.members.get(0).unwrap();
    s.client.contribute(&m);
    assert_eq!(s.client.try_contribute(&m), Err(Ok(Error::AlreadyPaid)));

    let outsider = Address::generate(&s.env);
    assert_eq!(s.client.try_contribute(&outsider), Err(Ok(Error::NotMember)));
}

#[test]
fn payout_waits_for_everyone() {
    let s = setup();
    for i in 0..4 {
        s.client.contribute(&s.members.get(i).unwrap());
    }
    assert_eq!(s.client.try_payout(), Err(Ok(Error::NotAllPaid)));
    s.client.contribute(&s.members.get(4).unwrap());
    s.client.payout();
    let st = s.client.get_state();
    assert_eq!(st.round, 1);
    assert_eq!(st.paid.len(), 0);
}

#[test]
#[should_panic(expected = "membre en double")]
fn rejects_duplicate_members() {
    let env = Env::default();
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let a = Address::generate(&env);
    env.register(TrustCircle, (sac.address(), vec![&env, a.clone(), a], AMOUNT));
}
