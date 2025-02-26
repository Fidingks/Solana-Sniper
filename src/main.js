const YellowstoneGrpc = require("@triton-one/yellowstone-grpc").default;
const bs58 = require("bs58");
const { Buffer } = require("buffer");
const { format } = require("date-fns");
const dotenv = require("dotenv");
const fs = require('fs').promises;
// 加载环境变量
dotenv.config();

// 配置参数
const GRPC_URL = process.env.GRPC_URL || "https://solana-yellowstone-grpc.publicnode.com:443";
const PING_INTERVAL_MS = parseInt(process.env.PING_INTERVAL_MS || "1000", 10);
const PUMP_ACCOUNT = process.env.PUMP_ACCOUNT || "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM";

// 初始化 gRPC 客户端
const client = new YellowstoneGrpc(GRPC_URL, {
  "grpc.max_receive_message_length": 64 * 1024 * 1024,
});
async function logToFile(message) {
  const timestamp = new Date().toISOString();
  await fs.appendFile('log.txt', `[${timestamp}] ${message}\n`);
  console.log(`[${timestamp}] ${message}`);
}
// 获取当前时间戳的函数// 获取北京时间的函数
function getFormattedTime() {
  const beijingTime = new Date(new Date().getTime() + 6 * 60 * 60 * 1000);
  return `[${format(beijingTime, "yyyy-MM-dd HH:mm:ss.SSS", { timeZone: 'Asia/Shanghai' })}]`;
}


// 创建订阅请求
function createSubscribeRequest() {
  return {
    slots: {},
    accounts: {},
    transactions: {
      pumpdotfun: {
        vote: false,
        failed: false,
        signature: undefined,
        // accountInclude: ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],  这一个应该是池子的交易
        accountInclude: [PUMP_ACCOUNT],
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    accountsDataSlice: [],
    commitment: "processed",
    entry: {},
  };
}

// 处理订阅逻辑
function handleSubscribe(client_stream, args) {
  return new Promise((resolve, reject) => {
    client_stream.on("error", (error) => {
      console.error(`${getFormattedTime()} Stream error: ${error.message}`);
      client_stream.end();
      reject(error);
    });

    client_stream.on("end", resolve);
    client_stream.on("close", resolve);

    // 发送订阅请求
    client_stream.write(args, (err) => {
      if (err) {
        console.error(`${getFormattedTime()} Subscribe Error: ${err.message}`);
        reject(err);
      }
    });

    // 设置 ping
    const pingRequest = {
      ping: { id: 1 },
      accounts: {},
      accountsDataSlice: [],
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      slots: {},
    };

    const pingInterval = setInterval(() => {
      client_stream.write(pingRequest, (err) => {
        if (err) {
          console.error(`${getFormattedTime()} Ping Error: ${err.message}`);
        }
      });
    }, PING_INTERVAL_MS);

    client_stream.on("close", () => {
      clearInterval(pingInterval);
      console.info(`${getFormattedTime()} Stream closed`);
    });
  });
}

// 监控链上新代币的创建
async function monitorNewTokens() {
  try {
    const stream = await client.subscribe();
    const request = createSubscribeRequest();

    handleSubscribe(stream, request).catch(error => {
      console.error(`${getFormattedTime()} 订阅错误: ${error.message}`);
    });
    let num = 0
    stream.on("data", ({ transaction }) => {
      if (!transaction) return;
      const { slot, transaction: { meta, signature, transaction: tx } } = transaction;
      const mintAddress = meta.postTokenBalances?.[0]?.mint;
      if (!mintAddress) return;
      const creator = meta.postTokenBalances?.[1]?.owner || "未知";
      const bondingCurveAddress = tx?.message?.accountKeys?.length >= 3 
        ? bs58.encode(tx.message.accountKeys[2]) 
        : "未知";
      const associatedBondingCurveAddress = tx?.message?.accountKeys?.length >= 4 
        ? bs58.encode(tx.message.accountKeys[3]) 
        : "未知";
      const tokenBalance = meta.postTokenBalances[0];
       
      console.log([
        `${getFormattedTime()} ===== 第${num+1}个新代币创建 =====`,
        `${getFormattedTime()} 区块槽位: ${slot}`,
        `${getFormattedTime()} 合约地址: \x1b[32m${mintAddress}\x1b[0m`,
        `${getFormattedTime()} 代币创建者: \x1b[33m${creator}\x1b[0m`,
        `${getFormattedTime()} Bonding Curve: \x1b[34m${bondingCurveAddress}\x1b[0m`,
        `${getFormattedTime()} Associated Bonding Curve: \x1b[35m${associatedBondingCurveAddress}\x1b[0m`,
        `${getFormattedTime()} 代币精度: ${tokenBalance.uiTokenAmount?.decimals || '未知'}`,
        `${getFormattedTime()} 初始供应量: ${tokenBalance.uiTokenAmount?.uiAmount || '未知'}`,
        `${getFormattedTime()} 交易费用: ${meta.fee ? meta.fee / 1e9 : '未知'} SOL`,
        `${getFormattedTime()} 交易状态: ${meta.err ? '失败' : '成功'}`,
        `${getFormattedTime()} 查询链接: https://solscan.io/tx/${bs58.encode(Buffer.from(signature))}`,
        `${getFormattedTime()} ==================\n`
      ].join('\n'));
      num++
    });

    stream.on("error", async (error) => {
      console.error(`${getFormattedTime()} Stream error: ${error.message}`);
      console.info(`${getFormattedTime()} 正在尝试重连...`);
      await monitorNewTokens();
    });
  } catch (error) {
    console.error(`${getFormattedTime()} 监控失败: ${error.message}`);
  }
}

// 启动监控
(async () => {
  console.info(`${getFormattedTime()} 启动 PUMP 新币监控...`);
  await monitorNewTokens();
})(); 