# Synthetic Signals — Boom 1000 (paper only)

Servicio Python asíncrono para observar ticks públicos de Boom 1000 en Deriv, calcular indicadores de alta frecuencia, almacenar muestras y emitir **señales paper** a partir de un modelo previamente entrenado.

No contiene `authorize`, compra, venta, contratos, tokens de cuentas ni integración de ejecución. Una señal no es una garantía ni una orden.

## Arquitectura

```text
Deriv WebSocket público → reconexión/backoff → buffer de ticks
        ├→ escritura Parquet por lotes
        └→ features causales → clasificador calibrado → risk gate → señal PAPER JSON
```

Controles incluidos:

- Reconexión exponencial, ping WebSocket y buffer circular.
- Latencia/heartbeat, ticks fuera de orden y huecos del feed: activan kill switch.
- Máximo drawdown diario configurable; por defecto 1% del balance paper.
- Persistencia por lotes fuera del camino crítico de la ingesta.
- El modelo ausente bloquea las señales en vez de inventar probabilidades.

## Instalación

Desde esta carpeta:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
```

No requiere claves ni cuenta para datos públicos. Revisa `config.yaml`; el valor de `symbol` puede cambiarse a `CRASH1000` para observación de ese índice.

## Capturar ticks

```powershell
synthetic-signals --config config.yaml
```

El proceso escribirá lotes Parquet en `data/`. Mientras no exista `models/boom1000_spike_model.joblib`, capturará ticks pero no emitirá señales. Detén con `Ctrl+C` tras reunir una muestra amplia y diversa.

## Entrenar el clasificador

No entrenes con pocos minutos de datos. Como mínimo se exige 5.000 ticks, aunque para investigación responsable se requieren múltiples periodos y validación fuera de muestra.

```powershell
synthetic-train --input "data/*.parquet" --output models/boom1000_spike_model.joblib --horizon 25
```

El entrenamiento:

1. Obtiene el umbral de spike del 99.5 percentil de retornos solo del tramo de entrenamiento.
2. Etiqueta si el máximo retorno de los siguientes `N` ticks supera ese umbral.
3. Mantiene un split cronológico 60/20/20, sin barajar ticks.
4. Entrena un Random Forest balanceado y calibra sus probabilidades con validación temporal.
5. Guarda el modelo y métricas (`average_precision`, `brier`, precision/recall al umbral 0.80).

No promociones el modelo si las métricas del tramo final no son estables; accuracy no es una métrica válida para eventos de spike poco frecuentes.

## Pruebas

```powershell
python -m unittest discover -s tests -v
```

## Límites de riesgo

`paper_risk_percent` determina un presupuesto de riesgo informativo, no un lote. En Deriv la unidad puede ser stake, payout, multiplicador o contrato; una futura integración de ejecución requeriría un adaptador independiente que valide explícitamente el producto, la pérdida máxima y la cuenta. Este repositorio no implementa dicho adaptador.
