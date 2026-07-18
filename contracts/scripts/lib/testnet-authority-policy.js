const { ethers } = require('ethers')

const SAFE_VERSION = '1.4.1'
const SAFE_OWNER_COUNT = 3
const SAFE_THRESHOLD = 2
const SAFE_ABI = [
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function VERSION() view returns (string)',
]
const AUTHORITY_NAMES = ['governance', 'treasury', 'pauseGuardian']

function normalizeAddress(value, label) {
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(label + ' must be a non-zero EVM address')
  }
  return ethers.getAddress(value)
}

function validateSafeDescriptor(descriptor, label) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error(label + ' Safe descriptor is required')
  }
  if (!Array.isArray(descriptor.owners)) {
    throw new Error(label + ' owners must be an array')
  }
  const owners = descriptor.owners.map((owner, index) =>
    normalizeAddress(owner, label + ' owner ' + (index + 1))
  )
  if (owners.length !== SAFE_OWNER_COUNT) {
    throw new Error(label + ' must have exactly ' + SAFE_OWNER_COUNT + ' owners')
  }
  if (new Set(owners.map((owner) => owner.toLowerCase())).size !== owners.length) {
    throw new Error(label + ' owners must be distinct')
  }
  if (descriptor.threshold !== SAFE_THRESHOLD) {
    throw new Error(label + ' threshold must be exactly ' + SAFE_THRESHOLD)
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(descriptor.saltNonce ?? '')) {
    throw new Error(label + ' saltNonce must be a 32-byte hex value')
  }
  return { owners, threshold: SAFE_THRESHOLD, saltNonce: descriptor.saltNonce }
}

function validateAuthorityPlan(plan) {
  if (
    plan?.schemaVersion !== 1 ||
    plan?.kind !== 'velostra-testnet-safe-authority-plan' ||
    plan?.environment !== 'staging' ||
    plan?.region !== 'us-east4' ||
    plan?.network !== 'robinhood-testnet' ||
    plan?.chainId !== 46630
  ) {
    throw new Error('Authority plan is not an authorized US testnet plan')
  }

  const roles = Object.fromEntries(
    AUTHORITY_NAMES.map((name) => [
      name,
      validateSafeDescriptor(plan.roles?.[name], name),
    ])
  )
  const allOwners = AUTHORITY_NAMES.flatMap((name) => roles[name].owners)
  if (
    new Set(allOwners.map((owner) => owner.toLowerCase())).size !==
    allOwners.length
  ) {
    throw new Error('Authority Safe owner sets must be disjoint')
  }
  const salts = AUTHORITY_NAMES.map((name) => roles[name].saltNonce.toLowerCase())
  if (new Set(salts).size !== salts.length) {
    throw new Error('Authority Safe salt nonces must be distinct')
  }
  return roles
}

function validateSafeState(state, label, expectedOwners) {
  if (state.code === '0x') throw new Error(label + ' must be deployed contract code')
  if (state.version !== SAFE_VERSION) {
    throw new Error(label + ' must use Safe version ' + SAFE_VERSION)
  }
  const owners = state.owners.map((owner, index) =>
    normalizeAddress(owner, label + ' onchain owner ' + (index + 1))
  )
  if (owners.length !== SAFE_OWNER_COUNT) {
    throw new Error(label + ' must have exactly ' + SAFE_OWNER_COUNT + ' onchain owners')
  }
  if (new Set(owners.map((owner) => owner.toLowerCase())).size !== owners.length) {
    throw new Error(label + ' onchain owners must be distinct')
  }
  if (Number(state.threshold) !== SAFE_THRESHOLD) {
    throw new Error(label + ' onchain threshold must be exactly ' + SAFE_THRESHOLD)
  }
  if (expectedOwners) {
    const expected = expectedOwners.map((owner) =>
      normalizeAddress(owner, label + ' expected owner')
    )
    const actualSet = new Set(owners.map((owner) => owner.toLowerCase()))
    if (
      expected.length !== owners.length ||
      expected.some((owner) => !actualSet.has(owner.toLowerCase()))
    ) {
      throw new Error(label + ' onchain owners do not match the authority plan')
    }
  }
  return { owners, threshold: SAFE_THRESHOLD, version: state.version }
}

async function inspectSafe(provider, address, label, expectedOwners) {
  const normalized = normalizeAddress(address, label)
  const code = await provider.getCode(normalized)
  try {
    const safe = new ethers.Contract(normalized, SAFE_ABI, provider)
    const [owners, threshold, version] = await Promise.all([
      safe.getOwners(),
      safe.getThreshold(),
      safe.VERSION(),
    ])
    return validateSafeState(
      { code, owners: [...owners], threshold, version },
      label,
      expectedOwners
    )
  } catch (error) {
    if (error.message?.startsWith(label)) throw error
    throw new Error(label + ' is not a readable Safe account')
  }
}

function validateInspectedAuthoritySet(authorities, settlerCode) {
  if (settlerCode !== '0x') {
    throw new Error('SETTLER_ADDRESS must be the isolated non-contract signer')
  }
  const owners = AUTHORITY_NAMES.flatMap((name) => authorities[name].owners)
  if (new Set(owners.map((owner) => owner.toLowerCase())).size !== owners.length) {
    throw new Error('Authority Safe owner sets must be disjoint')
  }
  return authorities
}

async function assertAuthorityPrincipals(provider, roles) {
  const roleAddresses = [roles.admin, roles.treasury, roles.pauseGuardian]
  if (new Set(roleAddresses.map((value) => value.toLowerCase())).size !== 3) {
    throw new Error('Authority Safe addresses must be distinct')
  }
  const [governance, treasury, pauseGuardian, settlerCode] = await Promise.all([
    inspectSafe(provider, roles.admin, 'governance Safe'),
    inspectSafe(provider, roles.treasury, 'treasury Safe'),
    inspectSafe(provider, roles.pauseGuardian, 'pause guardian Safe'),
    provider.getCode(roles.settler),
  ])
  return validateInspectedAuthoritySet(
    { governance, treasury, pauseGuardian },
    settlerCode
  )
}

module.exports = {
  AUTHORITY_NAMES,
  SAFE_OWNER_COUNT,
  SAFE_THRESHOLD,
  SAFE_VERSION,
  assertAuthorityPrincipals,
  inspectSafe,
  validateInspectedAuthoritySet,
  validateAuthorityPlan,
  validateSafeDescriptor,
  validateSafeState,
}
