export const reconciliationReorgPolicy = 'confirmation-depth' as const

export interface BlockRange {
  fromBlock: bigint
  toBlock: bigint
}

export function confirmedSafeHead(latestBlock: bigint, confirmations: bigint): bigint {
  if (latestBlock < 0n || confirmations < 0n) {
    throw new Error('Block height and confirmation depth must be non-negative')
  }
  return latestBlock > confirmations ? latestBlock - confirmations : 0n
}

export function planBlockRanges(
  fromBlock: bigint,
  toBlock: bigint,
  maxBlockRange: bigint
): BlockRange[] {
  if (maxBlockRange <= 0n) throw new Error('Maximum block range must be positive')
  if (fromBlock > toBlock) return []

  const ranges: BlockRange[] = []
  for (let cursor = fromBlock; cursor <= toBlock; cursor += maxBlockRange) {
    ranges.push({
      fromBlock: cursor,
      toBlock: cursor + maxBlockRange - 1n < toBlock
        ? cursor + maxBlockRange - 1n
        : toBlock,
    })
  }
  return ranges
}
