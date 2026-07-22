import type { AGENT_CATEGORIES } from '../lib/constants.js'

type AgentCategory = (typeof AGENT_CATEGORIES)[number]

export interface SyntheticAgentProfile {
  slug: string
  name: string
  description: string
  longDescription: string
  category: AgentCategory
  price: number
  featured: boolean
  endpointPath: `/execute${string}`
  tags: string[]
  scenario: {
    id: string
    title: string
    prompt: string
    result: Record<string, unknown>
  }
}

export const SYNTHETIC_AGENT_CATALOG: readonly SyntheticAgentProfile[] = [
  {
    slug: 'phase2-synthetic-agent',
    name: 'Velostra Staging Synthetic',
    description: 'Deterministic synthetic execution for isolated staging verification.',
    longDescription: 'A non-production, non-persistent endpoint used only for Velostra release evidence.',
    category: 'DATA_ANALYSIS',
    price: 1.2,
    featured: false,
    endpointPath: '/execute',
    tags: ['staging', 'synthetic', 'deterministic', 'release-evidence'],
    scenario: {
      id: 'execution-proof',
      title: 'Verify the execution envelope',
      prompt: 'Return a deterministic execution receipt for this public testnet call.',
      result: {
        message: 'Synthetic staging execution complete',
        verification: 'release-envelope-valid',
      },
    },
  },
  {
    slug: 'flowbook-trader',
    name: 'Flowbook Trader',
    description: 'Builds a deterministic market-structure brief with explicit execution guardrails.',
    longDescription: 'A public testnet demonstration of priced agent execution. It returns synthetic market structure, risk controls, and a correlated receipt without placing an order or using live market data.',
    category: 'TRADING',
    price: 4,
    featured: true,
    endpointPath: '/execute/flowbook-trader',
    tags: ['testnet-demo', 'market-structure', 'risk-controls', 'deterministic'],
    scenario: {
      id: 'market-brief',
      title: 'Price a disciplined market brief',
      prompt: 'Create a risk-balanced ETH market structure brief with an invalidation rule and no live order execution.',
      result: {
        mode: 'synthetic-market-brief',
        regime: 'range-with-expansion-risk',
        posture: 'wait-for-confirmation',
        signals: ['momentum: mixed', 'liquidity: balanced', 'volatility: elevated'],
        guardrails: ['no live order placed', 'invalidate on structure break', 'size only after confirmation'],
      },
    },
  },
  {
    slug: 'wallet-sentinel',
    name: 'Wallet Sentinel',
    description: 'Produces a privacy-safe approval-risk review for a synthetic wallet activity set.',
    longDescription: 'A deterministic wallet-security scenario for public testnet. It demonstrates how an agent can return prioritized approval findings without retaining or echoing the submitted input.',
    category: 'WALLET_ANALYSIS',
    price: 0.2,
    featured: true,
    endpointPath: '/execute/wallet-sentinel',
    tags: ['testnet-demo', 'wallet-security', 'approval-risk', 'privacy-safe'],
    scenario: {
      id: 'approval-risk',
      title: 'Review synthetic approval risk',
      prompt: 'Review a synthetic wallet activity set for stale approvals, unusual spenders, and practical revocation priorities.',
      result: {
        mode: 'synthetic-wallet-review',
        risk_level: 'review',
        findings: [
          'one unlimited approval should be reduced',
          'one inactive spender should be revoked',
          'no private key or seed phrase is required',
        ],
        next_action: 'verify each spender before signing a revocation',
      },
    },
  },
  {
    slug: 'token-scope',
    name: 'TokenScope',
    description: 'Turns a token research request into a structured, evidence-first diligence checklist.',
    longDescription: 'A public testnet research demonstration that separates verifiable evidence, unresolved assumptions, and decision blockers. Its output is synthetic and is not investment advice.',
    category: 'TOKEN_RESEARCH',
    price: 1.4,
    featured: true,
    endpointPath: '/execute/token-scope',
    tags: ['testnet-demo', 'token-research', 'due-diligence', 'evidence-first'],
    scenario: {
      id: 'diligence-checklist',
      title: 'Build an evidence-first token checklist',
      prompt: 'Create a concise token diligence checklist covering supply, authority, liquidity, treasury, and unresolved evidence gaps.',
      result: {
        mode: 'synthetic-diligence',
        verdict: 'research-required',
        checklist: ['supply and unlocks', 'admin authority', 'liquidity concentration', 'treasury flows'],
        unresolved: ['independent contract review', 'verified distribution history'],
      },
    },
  },
  {
    slug: 'contract-lens',
    name: 'Contract Lens',
    description: 'Surfaces settlement invariants and review priorities from a synthetic contract change.',
    longDescription: 'A deterministic smart-contract review scenario for public testnet. It demonstrates structured findings and explicit limitations; it is not a substitute for a professional security audit.',
    category: 'CODE',
    price: 2.8,
    featured: true,
    endpointPath: '/execute/contract-lens',
    tags: ['testnet-demo', 'smart-contracts', 'invariants', 'security-review'],
    scenario: {
      id: 'settlement-invariants',
      title: 'Inspect settlement invariants',
      prompt: 'Review a synthetic escrow change for authorization, replay protection, accounting, and reconciliation risks.',
      result: {
        mode: 'synthetic-contract-review',
        severity: 'medium',
        findings: [
          'preserve conditional settlement finalization',
          'bind every credit to a unique call identifier',
          'retain replay-safe transaction uniqueness',
        ],
        limitation: 'demonstration output; independent audit still required',
      },
    },
  },
] as const

const profilesByPath = new Map<string, SyntheticAgentProfile>(
  SYNTHETIC_AGENT_CATALOG.map((profile) => [profile.endpointPath, profile])
)

export function syntheticProfileForPath(path: string): SyntheticAgentProfile | undefined {
  return profilesByPath.get(path)
}
