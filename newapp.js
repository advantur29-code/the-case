const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');

// Настройки
const bot = new Telegraf('8320351958:AAF2ZnbuxKAqGXZwbc8bMUIZfCvf-G8pb-4');
const ADMIN_ID = 8019223768; // Твой ID для получения заявок
const app = express();

app.use(cors());
app.use(bodyParser.json());

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
    ctx.reply(`Добро пожаловать в TheCase! 📦\nТвой баланс: ${users[userId].balance} TC.\nУдачных открытий!`);
});

// --- API ДЛЯ МИНИ-ПРИЛОЖЕНИЯ ---

// 1. Синхронизация
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

// 2. Обновление баланса
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

// 3. Пополнение (Stars)
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

// 4. Вывод средств (Заявка админу)
app.post('/withdraw', async (req, res) => {
    const { userId, amount, wallet } = req.body;
    const id = userId?.toString();

    if (!id || !users[id] || users[id].balance < amount) {
        return res.status(400).json({ error: "Недостаточно средств" });
    }

    if (amount < 1000) {
        return res.status(400).json({ error: "Минимальный вывод — 1000 TC" });
    }

    // Списываем баланс сразу
    users[id].balance -= amount;
    saveDB();

    // Отправляем уведомление тебе
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

// 5. Промокоды
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
    bot.launch();
});
