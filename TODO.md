# TODO - Fix Sepolia facet upgrade deployment timeouts

## Plan items

- [ ] Update `scripts/upgradeFacets.js`: increase deployment timeout and improve logging.
- [x] Update `scripts/utils.js`: add preflight RPC check + retry logic around `waitForDeployment()`.

- [ ] Re-run `npm run upgrade:lending` to verify.
