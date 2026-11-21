"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.portfolioRouter = void 0;
var express_1 = require("express");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
exports.portfolioRouter = (0, express_1.Router)();
var mockPrices = new Map([
    ['XLM', { symbol: 'XLM', price: 0.12, change24h: 2.5, lastUpdated: new Date() }],
    ['USDC', { symbol: 'USDC', price: 1.0, change24h: 0.01, lastUpdated: new Date() }],
    ['USDT', { symbol: 'USDT', price: 1.0, change24h: -0.02, lastUpdated: new Date() }],
    ['BTC', { symbol: 'BTC', price: 67500, change24h: 1.2, lastUpdated: new Date() }],
    ['ETH', { symbol: 'ETH', price: 3450, change24h: -0.8, lastUpdated: new Date() }],
    ['SOL', { symbol: 'SOL', price: 145, change24h: 3.2, lastUpdated: new Date() }],
]);
var chainRpcUrls = {
    stellar: 'https://horizon.stellar.org',
    ethereum: 'https://eth.llamarpc.com',
    solana: 'https://api.mainnet-beta.solana.com',
};
function getTokenPrice(symbol) {
    return mockPrices.get(symbol.toUpperCase());
}
function fetchChainBalance(address, chain, token) {
    return __awaiter(this, void 0, void 0, function () {
        var price, balance, balanceUsd;
        return __generator(this, function (_a) {
            price = getTokenPrice(token);
            balance = Math.random() * 1000;
            balanceUsd = price ? balance * price.price : 0;
            return [2 /*return*/, {
                    address: address,
                    chain: chain,
                    token: token,
                    balance: balance.toFixed(6),
                    balanceUsd: Math.round(balanceUsd * 100) / 100,
                }];
        });
    });
}
function calculatePortfolioAllocation(balances) {
    var totalUsd = balances.reduce(function (sum, b) { return sum + (b.balanceUsd || 0); }, 0);
    if (totalUsd === 0)
        return [];
    var tokenMap = new Map();
    for (var _i = 0, balances_1 = balances; _i < balances_1.length; _i++) {
        var balance = balances_1[_i];
        var current = tokenMap.get(balance.token) || 0;
        tokenMap.set(balance.token, current + (balance.balanceUsd || 0));
    }
    var allocations = [];
    for (var _a = 0, tokenMap_1 = tokenMap; _a < tokenMap_1.length; _a++) {
        var _b = tokenMap_1[_a], token = _b[0], valueUsd = _b[1];
        allocations.push({
            token: token,
            percentage: Math.round((valueUsd / totalUsd) * 10000) / 100,
            valueUSD: Math.round(valueUsd * 100) / 100,
        });
    }
    return allocations.sort(function (a, b) { return b.valueUSD - a.valueUSD; });
}
exports.portfolioRouter.get('/prices', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var prices;
    return __generator(this, function (_a) {
        prices = Array.from(mockPrices.values());
        res.json({ prices: prices, timestamp: new Date() });
        return [2 /*return*/];
    });
}); }));
exports.portfolioRouter.get('/prices/:symbol', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var symbol, price;
    return __generator(this, function (_a) {
        symbol = req.params.symbol;
        price = getTokenPrice(symbol);
        if (!price) {
            res.status(404).json({ error: 'Token price not found' });
            return [2 /*return*/];
        }
        res.json(price);
        return [2 /*return*/];
    });
}); }));
exports.portfolioRouter.post('/prices', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, symbol, price, change24h, tokenPrice;
    return __generator(this, function (_b) {
        _a = req.body, symbol = _a.symbol, price = _a.price, change24h = _a.change24h;
        if (!symbol || price === undefined) {
            res.status(400).json({ error: 'symbol and price are required' });
            return [2 /*return*/];
        }
        tokenPrice = {
            symbol: symbol.toUpperCase(),
            price: price,
            change24h: change24h || 0,
            lastUpdated: new Date(),
        };
        mockPrices.set(symbol.toUpperCase(), tokenPrice);
        res.json(tokenPrice);
        return [2 /*return*/];
    });
}); }));
exports.portfolioRouter.get('/balance', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, address, chains, tokens, chainList, tokenList, balances, totalUsd;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = req.query, address = _a.address, chains = _a.chains, tokens = _a.tokens;
                if (!address) {
                    res.status(400).json({ error: 'address is required' });
                    return [2 /*return*/];
                }
                chainList = chains ? chains.split(',') : ['stellar'];
                tokenList = tokens ? tokens.split(',') : ['XLM'];
                return [4 /*yield*/, Promise.all(chainList.flatMap(function (chain) {
                        return tokenList.map(function (token) { return fetchChainBalance(address, chain, token); });
                    }))];
            case 1:
                balances = _b.sent();
                totalUsd = balances.reduce(function (sum, b) { return sum + (b.balanceUsd || 0); }, 0);
                res.json({
                    address: address,
                    balances: balances,
                    totalUsd: Math.round(totalUsd * 100) / 100,
                    lastUpdated: new Date(),
                });
                return [2 /*return*/];
        }
    });
}); }));
exports.portfolioRouter.get('/', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, address, chains, tokens, chainList, tokenList, balances, totalUsd, totalChange24h, allocation;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = req.query, address = _a.address, chains = _a.chains, tokens = _a.tokens;
                if (!address) {
                    res.status(400).json({ error: 'address is required' });
                    return [2 /*return*/];
                }
                chainList = chains ? chains.split(',') : ['stellar'];
                tokenList = tokens ? tokens.split(',') : ['XLM', 'USDC'];
                return [4 /*yield*/, Promise.all(chainList.flatMap(function (chain) {
                        return tokenList.map(function (token) { return fetchChainBalance(address, chain, token); });
                    }))];
            case 1:
                balances = _b.sent();
                totalUsd = balances.reduce(function (sum, b) { return sum + (b.balanceUsd || 0); }, 0);
                totalChange24h = balances.reduce(function (sum, b) {
                    var price = getTokenPrice(b.token);
                    return sum + (price ? price.change24h * (b.balanceUsd || 0) : 0);
                }, 0) / totalUsd;
                allocation = calculatePortfolioAllocation(balances);
                res.json({
                    address: address,
                    chains: chainList,
                    tokens: tokenList,
                    balances: balances,
                    totalUsd: Math.round(totalUsd * 100) / 100,
                    change24h: Math.round(totalChange24h * 100) / 100,
                    allocation: allocation,
                    lastUpdated: new Date(),
                });
                return [2 /*return*/];
        }
    });
}); }));
exports.portfolioRouter.get('/history', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, address, _b, days, daysNum, history, baseValue, i, date, randomChange;
    return __generator(this, function (_c) {
        _a = req.query, address = _a.address, _b = _a.days, days = _b === void 0 ? '30' : _b;
        daysNum = parseInt(days, 10) || 30;
        history = [];
        baseValue = 10000;
        for (i = daysNum; i >= 0; i--) {
            date = new Date();
            date.setDate(date.getDate() - i);
            randomChange = 1 + (Math.random() - 0.5) * 0.1;
            history.push({
                date: date.toISOString().split('T')[0],
                valueUsd: Math.round(baseValue * randomChange * (1 - i / daysNum * 0.2)),
            });
        }
        res.json({
            address: address,
            history: history,
            days: daysNum,
        });
        return [2 /*return*/];
    });
}); }));
