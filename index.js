require('dotenv').config()

const fetch = require('node-fetch')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')

const {
  TG_BOT_NAME,
  TG_BOT_SECRET
} = process.env

// db stuff
const adapter = new FileSync('db.json', {
  serialize: data => JSON.stringify(data)
})
const db = low(adapter)
db.defaults({
  portfolio: [],
  logs: []
}).write()

const API = {
  sellPrice: 'http://localhost:5000/sellPrice',
  portfolio: 'http://localhost:5000/portfolio'
}

let previousTotalWorth = 0

const getWorth = async () => {
  const requests = []

  const { data: portfolio } = await fetch(API.portfolio).then(res => res.json())
  db.get('portfolio').set(portfolio).write()

  for (const deposit of portfolio) {
    const body = {
      destinationCoin: 'inr',
      destinationCoinAmount: null,
      depositCoin: deposit.coin,
      depositCoinAmount: deposit.amount.toString()
    }

    const request = fetch(`${API.sellPrice}?coin=${deposit.coin}&amount=${deposit.amount}`)
    requests.push(request)
  }

  const log = {
    time: Date.now(),
    totalWorth: 0,
    coinValues: {}
  }

  for await (const res of requests) {
    let { data: { coin, value, rate } } = await res.json()
    coin = coin.toUpperCase()
    log.totalWorth += value
    log.coinValues[coin] = { value, rate }
  }

  log.totalWorth = log.totalWorth.toFixed(2)

  db.get('logs')
    .push(log)
    .write()

  const delta = log.totalWorth - previousTotalWorth
  const relativeDelta = (delta / previousTotalWorth * 100).toFixed(2)

  if (Math.abs(relativeDelta) >= 0.5) {
    notify(delta, relativeDelta, log.totalWorth);
  }

  console.log(
    `[%s] INR %s %s%s / %s% \u001b[0m`,
    new Date().toLocaleTimeString(),
    Intl.NumberFormat('en-IN').format(log.totalWorth),
    delta < 0 ? '\u001b[31m' : '\u001b[32m',
    delta < 0 ? delta.toFixed(2) : '+' + delta.toFixed(2),
    delta < 0 ? relativeDelta : '+' + relativeDelta
  )

  previousTotalWorth = log.totalWorth
}

const notify = async (delta, relativeDelta, totalWorth) => {
  const symbol = relativeDelta > 0 ? '🟩' : '🟥'
  const symbols = new Array(Math.floor(Math.abs(relativeDelta) / 0.25) - 1).fill(symbol).join('')
  const message = [
    `*${symbols} Change in Portfolio Worth!*\n`,
    `\n*Total worth:* ₹${Intl.NumberFormat('en-IN').format(totalWorth)}/-`,
    `\n*Change:* ₹${Intl.NumberFormat('en-IN').format(delta)}/-`,
    ` (${relativeDelta >= 0 ? '+' : ''}${relativeDelta}%)`
  ].join('')

  await fetch(`https://tg.mihir.ch/${TG_BOT_NAME}`, {
    method: 'POST',
    body: JSON.stringify({
      text: message,
      secret: TG_BOT_SECRET
    }),
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

const main = async () => {
  let lastEntry = db.get('logs').value().pop()
  if (lastEntry) previousTotalWorth = Number(lastEntry.totalWorth)
  getWorth()
  setInterval(getWorth, 300000); // 5 minutes
}

main()
