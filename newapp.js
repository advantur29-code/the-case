const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path'); // Добавили для работы с путями

// Настройки
const bot = new Telegraf('8320351958:AAF2ZnbuxKAqGXZwbc8bMUIZfCvf-G8pb-4');
const ADMIN_ID = 8019223768; 
const app = express();

app.use(cors());
app.use(bodyParser.json());

// --- НОВОЕ: РАЗДАЧА ИНТЕРФЕЙСА (HTML, CSS, JS) ---
// Эта строка заставляет сервер "видеть" файлы в твоей папке
app.use(express.static(path.join(__dirname)));

// При заходе по прямой ссылке отдаем index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const DB_FILE = 'database.json';

// --- РАБОТА С БАЗОЙ ДАННЫХ ---
let users = {};
if (fs.existsSync(DB_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        console.log(`✅ БАЗА THECASE ЗАГРУЖЕНА: ${Object.keys(users).length} юзеров`);
    } catch (e) {
        console.log("❌ Ошибка чтения базы, создаем новую");
        users = {};
    }
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));

// --- ЛОГИКА ОПЛАТЫ STARS ---
bot.on('pre_checkout_query', async (ctx) => {
    try {
        await ctx.answerPreCheckoutQuery(true);
    } catch (e) {
        console.error("❌ Ошибка PreCheckout:", e);
    }
});

bot.on('successful_payment', async (ctx) => {
    try {
        const payment = ctx.message.successful_payment;
        const userId = payment.invoice_payload;
        const starsAmount = payment.total_amount;
        const bonusTC = starsAmount * 100;

        if (users[userId]) {
            users[userId].balance += bonusTC;
            saveDB();
            console.log(`💰 ПОПОЛНЕНИЕ: +${bonusTC} TC для ID ${userId}`);
            await ctx.reply(`✅ Оплата прошла! Начислено ${bonusTC.toLocaleString()} TC.`);
        }
    } catch (e) {
        console.error("❌ Ошибка в зачислении:", e);
    }
});

// --- КОМАНДЫ БОТА ---
bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    if (!users[userId]) {
        users[userId] = {
            username: ctx.from.username || 'User',
            balance: 500,
            inventory: [],
            usedPromos: []
        };
        saveDB();
    }
    // Кнопка для открытия приложения прямо в боте
    ctx.reply(`Добро пожаловать в TheCase, ${ctx.from.first_name}! 📦`, {
        reply_markup: {
            inline_keyboard: [[
                { text: "ОТКРЫТЬ КЕЙСЫ 🎮", web_app: { url: "https://the-case.onrender.com" } }
            ]]
        }
    });
});

// --- API ДЛЯ МИНИ-ПРИЛОЖЕНИЯ ---

app.post('/sync-user', (req, res) => {
    const userId = req.body.userId?.toString();
    if (!userId) return res.status(400).send("No ID");

    if (!users[userId]) {
        users[userId] = {
            username: req.body.username || 'User',
            balance: 500,
            inventory: [],
            usedPromos: []
        };
    }
    saveDB();
    res.json(users[userId]);
});

app.post('/update-balance', (req, res) => {
    const { userId, balance } = req.body;
    const id = userId?.toString();
    if (id && users[id]) {
        users[id].balance = balance;
        saveDB();
        return res.json({ ok: true });
    }
    res.status(400).json({ error: "User not found" });
});

app.post('/create-invoice', async (req, res) => {
    const { userId, stars } = req.body;
    try {
        const amount = parseInt(stars);
        const invoiceLink = await bot.telegram.createInvoiceLink({
            title: "Пополнение TheCase",
            description: `Обмен ${amount} Stars на ${amount * 100} TC`,
            payload: userId.toString(),
            provider_token: "",
            currency: "XTR",
            prices: [{ label: "Telegram Stars", amount: amount }]
        });
        res.json({ url: invoiceLink });
    } catch (e) {
        res.status(500).json({ error: "Ошибка API" });
    }
});

app.post('/withdraw', async (req, res) => {
    const { userId, amount, wallet } = req.body;
    const id = userId?.toString();

    if (!id || !users[id] || users[id].balance < amount) {
        return res.status(400).json({ error: "Недостаточно средств" });
    }

    if (amount < 1000) {
        return res.status(400).json({ error: "Минимальный вывод — 1000 TC" });
    }

    users[id].balance -= amount;
    saveDB();

    const adminMsg = `🚨 **ЗАЯВКА НА ВЫВОД**\n\n` +
        `👤 Юзер: @${users[id].username}\n` +
        `🆔 ID: \`${id}\`\n` +
        `💰 Сумма: **${amount.toLocaleString()} TC**\n` +
        `💳 Кошелек: \`${wallet}\``;

    try {
        await bot.telegram.sendMessage(ADMIN_ID, adminMsg, { parse_mode: 'Markdown' });
        res.json({ ok: true, newBalance: users[id].balance });
    } catch (e) {
        res.status(500).json({ error: "Ошибка отправки уведомления" });
    }
});

app.post('/apply-promo', (req, res) => {
    const userId = req.body.userId?.toString();
    const promo = (req.body.promo || "").toUpperCase();

    if (userId && users[userId]) {
        if (users[userId].usedPromos?.includes(promo)) {
            return res.status(400).json({ error: 'Уже использовано' });
        }

        let bonus = 0;
        if (promo === 'START') bonus = 1000;
        if (promo === 'CYBER') bonus = 5000;

        if (bonus > 0) {
            users[userId].balance += bonus;
            if (!users[userId].usedPromos) users[userId].usedPromos = [];
            users[userId].usedPromos.push(promo);
            saveDB();
            return res.json({ ok: true, newBalance: users[userId].balance });
        }
    }
    res.status(400).json({ error: 'Неверный код' });
});

// Запуск
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 THECASE SERVER LIVE | PORT ${PORT}`);
    bot.launch().catch(err => console.error("Ошибка запуска бота:", err));
});
