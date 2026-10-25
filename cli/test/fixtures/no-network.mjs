// Preload for tests: any network call prints NETWORK CALL and exits with 99.
import net from 'node:net'

const block = () => {
  console.error('NETWORK CALL')
  process.exit(99)
}
globalThis.fetch = block
net.Socket.prototype.connect = block
