# Aave Loan Test

A Hardhat-based Solidity project using a Diamond proxy architecture for an APS token, DEX, lending, price movement, and flash-loan-related flows.

## Architecture

The system is centered on one Diamond proxy contract:

- APSDEX (Diamond proxy)

The diamond implementation lives in `contracts/MainDiamond.sol`. `contracts/APSDEX.sol` is a thin compatibility wrapper so the existing deploy scripts and tests can keep using the APSDEX factory name.

Core deployed pieces:

- APS token contract
- Diamond proxy (APSDEX)
- Diamond implementation (MainDiamond)
- Diamond init contract
- Facets: DiamondCutFacet, DiamondLoupeFacet, OwnershipFacet, ApsdexFacet, LendingFacet, MovePriceFacet, FlashLoanFacet

All protocol actions in tests and scripts interact through the Diamond address using facet ABIs.

## Deployment and Initialization Sequence

Current full deployment command:

```bash
npm run deploy:all:hardhat
```

For a live network, use the network-specific script:

```bash
npm run deploy:all:sepolia
```

If you prefer the generic script, pass the network through `DEPLOY_NETWORK`:

```bash
DEPLOY_NETWORK=sepolia npm run deploy:all
```

Avoid `npm run deploy:all --network sepolia`; npm treats `--network` as its own config flag and prints warnings.

The sequence is:

1. Deploy APS token.
2. Deploy APSDEX (Diamond).
3. During APSDEX construction, deploy and register all facets through diamondCut and run DiamondInit.
4. Call LendingFacet.initializeLending(APS, Diamond).
5. Call MovePriceFacet.initializeMovePrice(APS, Diamond).
6. Resolve pool address for flash-loan integration.
7. Call FlashLoanFacet.initializeFlashLoan(pool).
8. Write all addresses to deployments/contract-addresses.json.

For local networks, a mock pool and mock provider are deployed automatically when no pool address env var is set. For sepolia, set FLASH_LOAN_POOL_ADDRESS or AAVE_POOLSEPOLIA_ADDRESS to your deployed Aave pool address.

## Main Components

- contracts/APS.sol

  - ERC20-style APS token used in lending and repayment flows.

- contracts/MainDiamond.sol

  - Diamond implementation that deploys and registers the facets.

- contracts/APSDEX.sol

  - Thin compatibility wrapper around MainDiamond for existing factory-based deployment and test flows.

- contracts/facets/ApsdexFacet.sol

  - APS/ETH pool operations and pricing functions.

- contracts/facets/LendingFacet.sol

  - Collateral, borrow, repay, health factor, and liquidation logic.

- contracts/facets/MovePriceFacet.sol

  - Price-moving helper logic used for testing liquidation scenarios.

- contracts/facets/FlashLoanFacet.sol
  - Flash-loan-related initialization and token withdrawal helpers.

## Facet Responsibilities

- DiamondCutFacet

  - Adds, replaces, or removes selectors in the Diamond.

- DiamondLoupeFacet

  - Exposes facet introspection (facet addresses and selectors).

- OwnershipFacet

  - Exposes owner and ownership transfer controls.

- ApsdexFacet

  - Maintains APS/ETH reserves, swaps, pool initialization, and spot price helpers.

- LendingFacet

  - Handles collateral deposits/withdrawals, borrowing, repayment, health factor checks, and liquidation.

- MovePriceFacet

  - Executes price-moving interactions against the DEX side of the protocol for risk and liquidation scenarios.

- FlashLoanFacet
  - Manages flash-loan setup and flash-loan utility operations tied to the configured pool.

## Deployment Output

The deployment registry file stores, per network:

- APS and APSDEX addresses
- DiamondInit address
- Per-facet addresses
- FlashLoanPool address
- Local mock addresses when applicable

Registry path:

- deployments/contract-addresses.json

## Tests

Run all tests:

```bash
npm test
```

Current tests target the Diamond architecture via the shared fixture:

- test/helpers/deployDiamond.js
- test/lendingTest.js
- test/FlashLoanTest.js

## Project Layout

```text
contracts/
  APS.sol
  MainDiamond.sol
  APSDEX.sol
  DiamondInterfaces/
  DiamondLibrary/
  facets/
  mocks/
  upgradeInitializers/

scripts/
  deployAll.js
  deployDiamond.js
  dumpFacets.js
  registry.js
  upgradeDiamond.js

test/
  helpers/
    deployDiamond.js
  lendingTest.js
  FlashLoanTest.js

deployments/
  contract-addresses.json
```

## Notes

- APSDEX is the external entry name used by scripts and tests, while MainDiamond holds the actual constructor and facet wiring logic.
- Standalone legacy contracts/scripts were removed in favor of a single Diamond-based path.
- If running on non-local networks, set the pool address in .env (FLASH_LOAN_POOL_ADDRESS or AAVE_POOLSEPOLIA_ADDRESS).
