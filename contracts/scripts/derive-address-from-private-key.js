const { ethers } = require('ethers')

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
})
process.stdin.on('end', () => {
  try {
    const privateKey = input.trim()
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      throw new Error('private key input must be exactly 32 bytes')
    }
    process.stdout.write(ethers.computeAddress(privateKey))
  } catch (error) {
    console.error('Unable to derive EVM address:', error.message || error)
    process.exitCode = 1
  } finally {
    input = ''
  }
})
