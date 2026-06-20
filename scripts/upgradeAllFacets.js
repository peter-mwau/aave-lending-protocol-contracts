// scripts/upgradeAllFacets.js
const { execSync } = require('child_process');

const FACETS = [
    'lending',
    'apsdex',
    'flashLoan',
    'movePrice',
    'ownership',
    'diamondcut',
    'diamondloupe'
];

const network = process.env.DEPLOY_NETWORK || 'sepolia';

console.log(`🔄 Upgrading all facets on ${network}...\n`);

let failedFacets = [];

for (const facet of FACETS) {
    console.log(`\n📦 Upgrading ${facet}...`);
    console.log('─'.repeat(50));

    try {
        execSync(
            `FACET=${facet} npx hardhat run scripts/upgradeFacets.js --network ${network}`,
            { stdio: 'inherit' }
        );
        console.log(`✅ ${facet} upgraded successfully`);
    } catch (error) {
        console.error(`❌ ${facet} upgrade failed`);
        failedFacets.push(facet);
    }
}

console.log('\n' + '═'.repeat(50));
console.log('📊 Upgrade Summary:');
console.log('═'.repeat(50));

if (failedFacets.length === 0) {
    console.log('✅ All facets upgraded successfully!');
} else {
    console.log(`❌ Failed facets: ${failedFacets.join(', ')}`);
    process.exit(1);
}