# Отклик

Сайт и серверное API для базы знаний, заявок на тарифы и подключения почтовых аккаунтов.

## Локальный запуск

Нужен Node.js 22.5 или новее. Проект использует встроенный `node:sqlite`.

```powershell
Copy-Item .env.example .env
npm run generate:secrets
# Скопируйте выведенные ключи в .env
npm ci
npm test
npm start
```

После запуска сайт доступен по `http://127.0.0.1:3000`, проверка состояния — `/healthz`.

При первом запуске сервер импортирует существующие `database/users.json`, `database/email-accounts.json` и `database/requests.json` в `data/otklik.db`. Исходные JSON-файлы не удаляются. Повторный импорт не выполняется.

## Обязательные настройки перед публикацией

- `NODE_ENV=production`, `HOST=0.0.0.0`, `COOKIE_SECURE=1`.
- `TOKEN_ENCRYPTION_KEY` — постоянный секрет для шифрования OAuth-токенов. Его смена требует отдельной миграции данных.
- `ADMIN_API_KEY` — ключ для просмотра заявок и ручной активации тарифов.
- `TRUST_PROXY=1`, если перед приложением находится один доверенный reverse proxy.
- Google OAuth-параметры из `.env.example`, если подключается Gmail.
- `REQUEST_WEBHOOK_URL`, если заявки должны сразу приходить в CRM или систему уведомлений.

Список новых заявок: `GET /api/admin/requests` с заголовком `Authorization: Bearer <ADMIN_API_KEY>`. Статус меняется через `PATCH /api/admin/requests/:id` с `{"status":"in_progress"}`. Тариф можно активировать по email через `PATCH /api/admin/users/tariff` с `{"email":"user@example.com","tariff":"start"}`.

## Данные и резервные копии

Рабочая база находится в `data/otklik.db` и исключена из Git. Команда `npm run backup` создаёт согласованный снимок SQLite в `backups/` без остановки сервера и сохраняет последние 14 копий по умолчанию. Число копий задаёт `BACKUP_KEEP`. Регулярно переносите резервные копии на отдельное хранилище и проверяйте восстановление.

## Docker

```powershell
docker build -t otklik .
docker run --rm -p 3000:3000 --env-file .env -v otklik-data:/app/data otklik
```

TLS завершается на reverse proxy. В production контейнер запускается от непривилегированного пользователя, а `/healthz` используется для health check.

## Проверки

```powershell
npm run check
npm test
npm audit --omit=dev
npm run backup
```

Реальная отправка кампаний, подтверждение email и восстановление пароля требуют выбранного почтового провайдера и вынесенного фонового обработчика. До подключения этих сервисов интерфейс не должен обещать автоматическую отправку.
