#!/bin/bash
# ULTIMATE AZURE TRADING BOX SETUP - ONE CLICK INSTALLER
# Run with: bash setup-trading-box.sh

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 AZURE TRADING BOX SETUP STARTING...${NC}"

# Get user inputs
echo -e "${YELLOW}Enter a password for code-server (VSCode in browser):${NC}"
read -s CODE_SERVER_PASSWORD
echo

# 1. SYSTEM UPDATE & ESSENTIAL TOOLS
echo -e "${GREEN}[1/8] Updating system and installing essentials...${NC}"
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential pkg-config libssl-dev libudev-dev \
    tmux htop glances net-tools jq unzip python3-pip nodejs npm

# 2. DISK SETUP FOR SOLANA
echo -e "${GREEN}[2/8] Setting up high-performance storage...${NC}"
if [ -b /dev/sdc ] && [ -b /dev/sdd ]; then
    sudo mdadm --create /dev/md0 --level=0 --raid-devices=2 /dev/sdc /dev/sdd --force
    sudo mkfs.ext4 -F /dev/md0
    sudo mkdir -p /mnt/solana
    sudo mount /dev/md0 /mnt/solana
    echo '/dev/md0 /mnt/solana ext4 defaults,noatime 0 0' | sudo tee -a /etc/fstab
else
    echo -e "${YELLOW}Using single disk setup...${NC}"
    sudo mkdir -p /mnt/solana
fi

# 3. PERFORMANCE TUNING
echo -e "${GREEN}[3/8] Applying performance optimizations...${NC}"
sudo tee -a /etc/sysctl.conf > /dev/null <<EOF
# Network optimizations for low latency
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.core.netdev_max_backlog = 30000
net.ipv4.tcp_congestion_control = bbr
net.core.default_qdisc = fq

# VM optimizations
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
EOF
sudo sysctl -p

# 4. INSTALL SOLANA
echo -e "${GREEN}[4/8] Installing Solana (latest stable)...${NC}"
sh -c "$(curl -sSfL https://release.solana.com/v1.18.17/install)"
export PATH="/home/$USER/.local/share/solana/install/active_release/bin:$PATH"
echo 'export PATH="/home/'$USER'/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc

# Generate validator keypair
solana-keygen new -o ~/validator-keypair.json --no-passphrase --force

# 5. CREATE SOLANA SERVICE
echo -e "${GREEN}[5/8] Creating Solana RPC service...${NC}"
sudo tee /etc/systemd/system/solana-rpc.service > /dev/null <<EOF
[Unit]
Description=Solana RPC Node
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/home/$USER
ExecStart=/home/$USER/.local/share/solana/install/active_release/bin/solana-validator \
  --ledger /mnt/solana/ledger \
  --identity /home/$USER/validator-keypair.json \
  --rpc-port 8899 \
  --rpc-bind-address 0.0.0.0 \
  --gossip-port 8001 \
  --dynamic-port-range 8002-8020 \
  --no-voting \
  --no-snapshot-fetch \
  --no-genesis-fetch \
  --entrypoint mainnet-beta.solana.com:8001 \
  --entrypoint entrypoint2.mainnet-beta.solana.com:8001 \
  --entrypoint entrypoint3.mainnet-beta.solana.com:8001 \
  --expected-genesis-hash 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d \
  --wal-recovery-mode skip_any_corrupted_record \
  --limit-ledger-size 50000000 \
  --enable-rpc-transaction-history \
  --enable-extended-tx-metadata-storage \
  --enable-rpc-bigtable-ledger-storage \
  --rpc-threads 16 \
  --account-index program-id \
  --account-index spl-token-owner \
  --account-index spl-token-mint \
  --log /home/$USER/solana-rpc.log
Restart=always
RestartSec=10
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
EOF

# 6. INSTALL CODE-SERVER
echo -e "${GREEN}[6/8] Installing code-server (VSCode in browser)...${NC}"
curl -fsSL https://code-server.dev/install.sh | sh
mkdir -p ~/.config/code-server
cat > ~/.config/code-server/config.yaml <<EOF
bind-addr: 0.0.0.0:8080
auth: password
password: $CODE_SERVER_PASSWORD
cert: false
EOF
sudo systemctl enable --now code-server@$USER

# 7. CREATE TRADING WORKSPACE
echo -e "${GREEN}[7/8] Setting up trading workspace...${NC}"
mkdir -p ~/trading-workspace/{bot,scripts,logs,data}

# Create monitoring dashboard script
cat > ~/trading-workspace/scripts/dashboard.sh << 'EOFSCRIPT'
#!/bin/bash
# Trading Dashboard - Shows everything at once

tmux new-session -d -s dashboard

# Window 1: Solana Node Logs
tmux rename-window -t dashboard:0 'Solana-Node'
tmux send-keys -t dashboard:0 'sudo journalctl -u solana-rpc -f' C-m

# Window 2: Bot Logs (split pane)
tmux new-window -t dashboard:1 -n 'Bot-Monitor'
tmux send-keys -t dashboard:1 'cd ~/trading-workspace/bot && tail -f logs/bot.log' C-m
tmux split-window -h -t dashboard:1
tmux send-keys -t dashboard:1.1 'cd ~/trading-workspace/bot && npm run dev' C-m

# Window 3: System Monitor (4 panes)
tmux new-window -t dashboard:2 -n 'System'
tmux send-keys -t dashboard:2 'htop' C-m
tmux split-window -h -t dashboard:2
tmux send-keys -t dashboard:2.1 'glances' C-m
tmux split-window -v -t dashboard:2.0
tmux send-keys -t dashboard:2.2 'watch -n 1 "curl -s localhost:8899/health | jq ."' C-m
tmux split-window -v -t dashboard:2.1
tmux send-keys -t dashboard:2.3 'sudo iotop' C-m

# Window 4: Blockchain Stats
tmux new-window -t dashboard:3 -n 'Blockchain'
tmux send-keys -t dashboard:3 'watch -n 2 "solana cluster-version && echo && solana validators --sort=stake | head -20"' C-m

# Attach to session
tmux attach -t dashboard
EOFSCRIPT

# Create bot integration script
cat > ~/trading-workspace/scripts/integrate-bot.sh << 'EOFSCRIPT'
#!/bin/bash
# Integrates your bot with local Solana node

echo "🔧 Bot Integration Helper"
echo "========================"
echo ""
echo "Add this to your bot's .env file:"
echo "SOLANA_RPC_URL=http://localhost:8899"
echo "SOLANA_WS_URL=ws://localhost:8900"
echo ""
echo "For ultra-fast detection, update your bot code:"
echo ""
cat << 'EOF'
// services/solana/localNode.js
const { Connection } = require('@solana/web3.js');

const connection = new Connection(
  'http://localhost:8899',
  {
    commitment: 'processed',
    wsEndpoint: 'ws://localhost:8900'
  }
);

// Real-time subscription example
connection.onAccountChange(walletPublicKey, (accountInfo) => {
  console.log('Wallet updated in ~10ms!', accountInfo);
});
EOF
EOFSCRIPT

# Create health check script
cat > ~/trading-workspace/scripts/health-check.sh << 'EOFSCRIPT'
#!/bin/bash
# Quick health check for all services

echo "🏥 System Health Check"
echo "====================="
echo ""

# Solana Node
echo -n "Solana RPC: "
if curl -s localhost:8899/health > /dev/null 2>&1; then
    echo "✅ Running"
    SLOT=$(curl -s localhost:8899 -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | jq -r '.result')
    echo "   Current Slot: $SLOT"
else
    echo "❌ Down"
fi

# Code Server
echo -n "Code Server: "
if curl -s localhost:8080 > /dev/null 2>&1; then
    echo "✅ Running at http://$(curl -s ifconfig.me):8080"
else
    echo "❌ Down"
fi

# System Resources
echo ""
echo "System Resources:"
echo "   CPU: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)% used"
echo "   RAM: $(free -h | awk '/^Mem:/ {print $3 "/" $2}')"
echo "   Disk: $(df -h /mnt/solana | awk 'NR==2 {print $3 "/" $2 " (" $5 " used)"}')"
EOFSCRIPT

# Make scripts executable
chmod +x ~/trading-workspace/scripts/*.sh

# 8. DOWNLOAD SOLANA SNAPSHOT (FASTEST SYNC)
echo -e "${GREEN}[8/8] Downloading Solana snapshot for fast sync...${NC}"
cd /mnt/solana
echo -e "${YELLOW}Downloading snapshot (this takes 30-60 minutes)...${NC}"
wget -c -T 0 https://snapshots.rpcpool.com/mainnet/snapshot.tar.bz2 || \
wget -c -T 0 https://snapshot.mainnet-beta.solana.com/snapshot.tar.bz2

echo -e "${YELLOW}Extracting snapshot...${NC}"
tar -xjf snapshot.tar.bz2
rm snapshot.tar.bz2

# Start services
echo -e "${GREEN}Starting all services...${NC}"
sudo systemctl daemon-reload
sudo systemctl enable solana-rpc
sudo systemctl start solana-rpc

# Create quick start guide
cat > ~/QUICKSTART.md << 'EOFGUIDE'
# 🚀 AZURE TRADING BOX QUICK START GUIDE

## Access Points
- **VSCode in Browser**: http://YOUR_IP:8080 (password set during setup)
- **SSH**: ssh azureuser@YOUR_IP
- **Solana RPC**: http://localhost:8899 (from bot)

## Essential Commands

### Start Trading Dashboard
```bash
~/trading-workspace/scripts/dashboard.sh