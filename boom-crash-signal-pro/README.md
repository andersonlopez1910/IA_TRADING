# Boom & Crash Signal Pro

Aplicación local, solo informativa, para Boom 1000 y Crash 1000. Usa el WebSocket público oficial de Deriv, descubre instrumentos mediante `active_symbols` y carga 5.000 ticks con `ticks_history` antes de analizar. No conecta cuentas ni ejecuta órdenes.

Ejecuta desde la raíz del proyecto: `php -S localhost:8080` y abre `http://localhost:8080/boom-crash-signal-pro/`.

El canal de datos públicos no necesita App ID ni token. Si en el futuro se usan funcionalidades autenticadas, registra una aplicación en el portal de Deriv y conserva App ID/tokens únicamente en backend; nunca en `localStorage` o JavaScript visible.
