export interface TestnetDemoScenario {
  id: string
  title: string
  prompt: string
  outcome: string
  proof: string
}

export interface TestnetDemoAgent {
  slug: string
  name: string
  category: string
  price: number
  summary: string
  scenario: TestnetDemoScenario
}

export const TESTNET_DEMO_AGENTS: readonly TestnetDemoAgent[] = [
  {
    slug: 'flowbook-trader',
    name: 'Flowbook Trader',
    category: 'Market structure',
    price: 4,
    summary: 'Turn a constrained market question into a priced brief with explicit risk controls.',
    scenario: {
      id: 'market-brief',
      title: 'Price a disciplined market brief',
      prompt: 'Create a risk-balanced ETH market structure brief with an invalidation rule and no live order execution.',
      outcome: 'A synthetic regime, posture, signal set, and execution guardrails.',
      proof: 'The receipt correlates the exact call to its testnet settlement.',
    },
  },
  {
    slug: 'wallet-sentinel',
    name: 'Wallet Sentinel',
    category: 'Wallet security',
    price: 0.2,
    summary: 'Review a synthetic wallet activity set without sharing a seed phrase or retaining the prompt.',
    scenario: {
      id: 'approval-risk',
      title: 'Review synthetic approval risk',
      prompt: 'Review a synthetic wallet activity set for stale approvals, unusual spenders, and practical revocation priorities.',
      outcome: 'A prioritized approval-risk summary with practical next actions.',
      proof: 'The output declares that input is not retained and never requests wallet secrets.',
    },
  },
  {
    slug: 'token-scope',
    name: 'TokenScope',
    category: 'Token research',
    price: 1.4,
    summary: 'Separate verifiable diligence evidence from unresolved assumptions and blockers.',
    scenario: {
      id: 'diligence-checklist',
      title: 'Build an evidence-first token checklist',
      prompt: 'Create a concise token diligence checklist covering supply, authority, liquidity, treasury, and unresolved evidence gaps.',
      outcome: 'A structured checklist, research verdict, and unresolved evidence list.',
      proof: 'The correlated call remains visible as a durable execution record.',
    },
  },
  {
    slug: 'contract-lens',
    name: 'Contract Lens',
    category: 'Contract review',
    price: 2.8,
    summary: 'Inspect a synthetic escrow change for the invariants that protect settlement.',
    scenario: {
      id: 'settlement-invariants',
      title: 'Inspect settlement invariants',
      prompt: 'Review a synthetic escrow change for authorization, replay protection, accounting, and reconciliation risks.',
      outcome: 'A deterministic severity and a focused invariant review list.',
      proof: 'The result is labeled as demonstration output, not a replacement for an audit.',
    },
  },
] as const

const demoAgentsBySlug = new Map(TESTNET_DEMO_AGENTS.map((agent) => [agent.slug, agent]))

export function testnetDemoAgentForSlug(slug: string | undefined): TestnetDemoAgent | undefined {
  return slug ? demoAgentsBySlug.get(slug) : undefined
}
