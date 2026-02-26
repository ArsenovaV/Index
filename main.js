// 1️⃣ Инициализация карты
const map = new maplibregl.Map({
    container: "map",
    style: "https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json",
    center: [37.6173, 55.7558],
    zoom: 9,
});

// Настраиваем порог зума
const ZOOM_THRESHOLD = 10; 

// Пути к данным
const DATASET_PATHS = {
    detailed: new URL("./data/Index.geojson", window.location.href).toString(),
    aggregated: new URL("./data/Index_5km.geojson", window.location.href).toString()
};

// Кешированные загруженные GeoJSON объекты
const DATA_CACHE = {
    detailed: null,
    aggregated: null
};

let activeDataset = "aggregated";
let currentField = "Index ZOZh"; // показание по умолчанию

// Создаем свою масштабную линейку с подписями кириллицей
class RussianScaleControl {
    onAdd(map) {
        this._map = map;

        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl russian-scale-control';

        this._line = document.createElement('div');
        this._line.className = 'russian-scale-line';

        this._labels = document.createElement('div');
        this._labels.className = 'russian-scale-labels';

        this._left = document.createElement('span');
        this._left.innerText = '0';

        this._right = document.createElement('span');

        this._labels.appendChild(this._left);
        this._labels.appendChild(this._right);

        this._container.appendChild(this._line);
        this._container.appendChild(this._labels);

        map.on('move', () => this._update());
        map.on('zoom', () => this._update());
        map.on('load', () => this._update());

        this._update();

        return this._container;
    }

    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }

    _update() {
        const map = this._map;

        const metersPerPixel =
            40075016.686 * Math.cos(map.getCenter().lat * Math.PI / 180) /
            Math.pow(2, map.getZoom() + 8);

        const maxWidth = 120; // максимальная длина линейки в px
        const maxMeters = metersPerPixel * maxWidth;

        // округляем до "красивого" значения (кратно 100 м)
        const niceMeters = this._getNiceNumber(maxMeters);

        const width = niceMeters / metersPerPixel;

        this._line.style.width = width + 'px';

        if (niceMeters >= 1000) {
            this._right.innerText = (niceMeters / 1000) + ' км';
        } else {
            this._right.innerText = niceMeters + ' м';
        }
    }

    _getNiceNumber(maxMeters) {
        // базовая прогрессия 1–2–5
        const baseSteps = [1, 2, 5];

        const exponent = Math.floor(Math.log10(maxMeters));
        const magnitude = Math.pow(10, exponent);

        let niceValue = magnitude;

        for (let i = 0; i < baseSteps.length; i++) {
            const candidate = baseSteps[i] * magnitude;
            if (candidate <= maxMeters) {
                niceValue = candidate;
            }
        }

        return niceValue;
    }
}

map.addControl(new RussianScaleControl(), 'bottom-right');

// Прелоадим оба geojson файла и положим в DATA_CACHE
async function preloadDatasets() {
    const paths = DATASET_PATHS;
    const p1 = fetch(paths.detailed).then(r => r.ok ? r.json() : Promise.reject(`Failed: ${paths.detailed}`));
    const p2 = fetch(paths.aggregated).then(r => r.ok ? r.json() : Promise.reject(`Failed: ${paths.aggregated}`));

    const [detailed, aggregated] = await Promise.all([p1, p2]);
    DATA_CACHE.detailed = detailed;
    DATA_CACHE.aggregated = aggregated;
}

// Получить расстояние в метрах видимой ширины (не используется в логике смены сейчас,
// но оставил вашу функцию, если потребуется)
function getVisibleWidthMeters() {
    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const lat = map.getCenter().lat;

    const p1 = new maplibregl.LngLat(west, lat);
    const p2 = new maplibregl.LngLat(east, lat);

    return p1.distanceTo(p2);
}

// Найти реальное имя свойства в data.features[...].properties,
// если выбранное поле не совпадает (учитывает пробелы/подчёркивания/регистр)
function resolvePropertyKey(fieldName, data) {
    if (!data || !data.features || data.features.length === 0) return null;

    const sampleProps = data.features[0].properties;
    if (fieldName in sampleProps) return fieldName;

    // нормализация
    const normalize = s => String(s).toLowerCase().replace(/\s+/g, '').replace(/_+/g, '');
    const target = normalize(fieldName);

    for (const key of Object.keys(sampleProps)) {
        if (normalize(key) === target) return key;
    }

    // если не нашлось точного соответствия — попробуем найти любое числовое свойство
    for (const key of Object.keys(sampleProps)) {
        const val = sampleProps[key];
        if (typeof val === 'number' && !isNaN(val)) return key;
        if (!isNaN(Number(val))) return key;
    }

    return null;
}

// Вычисление квартилей (оставил вашу логику)
function calculateQuartiles(values) {
    values.sort((a, b) => a - b);

    const q1 = values[Math.floor(values.length * 0.25)];
    const q2 = values[Math.floor(values.length * 0.50)];
    const q3 = values[Math.floor(values.length * 0.75)];

    return { q1, q2, q3 };
}

function getQuartileExpression(propertyKey, q1, q2, q3) {
    return [
        "step",
        ["get", propertyKey],
        "#FCFAFF",
        q1, "#D8C7F1",
        q2, "#8471A9",
        q3, "#301E67"
    ];
}

// Обновление легенды — ваша логика почти без изменений
function updateLegend(field, min, max, q1, q2, q3) {
    const titles = {
        "Index ZOZh": "Итоговый индекс ЗОЖ",
        "norm_n": "Коммерческий спорт",
        "norm_fitness": "Спортивные площадки",
        "norm_bad": "Негативные объекты",
        "norm_park_weighted_avail": "Рекреационная инфраструктура"
    };

    document.getElementById("legend-title").innerText = titles[field] || field;

    const colors = ["#FCFAFF", "#D8C7F1", "#8471A9", "#301E67"];

    document.getElementById("c1").style.background = colors[0];
    document.getElementById("c2").style.background = colors[1];
    document.getElementById("c3").style.background = colors[2];
    document.getElementById("c4").style.background = colors[3];

    document.getElementById("l1").innerText = `${min.toFixed(1)} – ${q1.toFixed(1)}`;
    document.getElementById("l2").innerText = `${q1.toFixed(1)} – ${q2.toFixed(1)}`;
    document.getElementById("l3").innerText = `${q2.toFixed(1)} – ${q3.toFixed(1)}`;
    document.getElementById("l4").innerText = `> ${q3.toFixed(1)}`;

    document.getElementById("legend-minmax").innerText =
        `Min: ${min.toFixed(1)} | Max: ${max.toFixed(1)}`;
}

// Обновление слоя: теперь мы берём данные из DATA_CACHE[activeDataset]
// и используем resolvePropertyKey чтобы найти реальное имя свойства
function updateLayer(field) {
    const data = DATA_CACHE[activeDataset];
    if (!data) return;

    // Найдём реальное имя свойства в этом датасете
    const propKey = resolvePropertyKey(field, data);
    if (!propKey) {
        console.warn("Поле не найдено в активном наборе данных:", field);
        // сбросим заливку в нейтральный цвет
        map.setPaintProperty("indexes-layer", "fill-color", "#ffffff");
        return;
    }

    const values = data.features
        .map(f => Number(f.properties[propKey]))
        .filter(v => !isNaN(v));

    if (!values.length) {
        console.warn("Нет числовых значений для поля", propKey);
        map.setPaintProperty("indexes-layer", "fill-color", "#ffffff");
        return;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const { q1, q2, q3 } = calculateQuartiles(values);

    const expression = getQuartileExpression(propKey, q1, q2, q3);

    map.setPaintProperty("indexes-layer", "fill-color", expression);

    updateLegend(field, min, max, q1, q2, q3);

    // Сохраняем в объекте свойства соответствие для popup (используем dataset + field)
    // Чтобы popup также знал реальное имя свойства
    map.__propertyKeyForPopup = map.__propertyKeyForPopup || {};
    map.__propertyKeyForPopup[activeDataset + "::" + field] = propKey;
}

// Переключение набора исходя из уровня зума (только зум)
function ensureDatasetByScale() {
    const zoom = map.getZoom();
    const nextDataset = zoom >= ZOOM_THRESHOLD ? "detailed" : "aggregated";

    if (nextDataset === activeDataset) return;

    activeDataset = nextDataset;

    // Передаём в источник уже загруженный объект GeoJSON
    const source = map.getSource("indexes");
    if (source) {
        source.setData(DATA_CACHE[nextDataset]);
    } else {
        console.warn("Источник indexes ещё не создан");
    }

    // Обновляем слой под текущий выбранный показатель
    updateLayer(currentField);
}

// ----------------- Сборка карты после загрузки -----------------
map.on("load", async () => {
    try {
        await preloadDatasets();
    } catch (err) {
        console.error("Ошибка загрузки датасетов:", err);
        return;
    }

    // Добавляем источник с предзагруженными данными (detailed по умолчанию)
    map.addSource("indexes", {
        type: "geojson",
        data: DATA_CACHE[activeDataset]
    });

    // Слой заполнения
    map.addLayer({
        id: "indexes-layer",
        type: "fill",
        source: "indexes",
        paint: {
            "fill-color": "#ffffff",
            "fill-opacity": 0.7
        }
    });

    // Контур
    map.addLayer({
        id: "indexes-outline",
        type: "line",
        source: "indexes",
        paint: {
            "line-color": "#ffffff",
            "line-width": 0
        }
    });

    // Обновляем по завершении движений
    map.on("moveend", () => {
        ensureDatasetByScale();
    });

    // Первый рендер слоя/легенды
    updateLayer(currentField);

    // Слой с административными границами
    map.addSource("msk-borders", {
        type: "geojson",
        data: new URL("./data/MSK_borders.geojson", window.location.href).toString()
    });

    map.addLayer({
        id: "msk-borders-layer",
        type: "line",
        source: "msk-borders",
        layout: {
            "line-join": "round",
            "line-cap": "round"
        },
        paint: {
            "line-color": "#5b5b5b",
            "line-width": 1.5
        }
    }, "indexes-layer");
    
});

// ----------------- UI / переключение показателей -----------------
document.querySelectorAll(".panel-title").forEach(title => {
    title.addEventListener("click", () => {
        const panel = title.parentElement;
        panel.classList.toggle("active");
    });
});

document.querySelectorAll(".indicator").forEach(item => {
    item.addEventListener("click", () => {

        document.querySelectorAll(".indicator")
            .forEach(i => i.classList.remove("active"));

        item.classList.add("active");

        const field = item.dataset.field;
        currentField = field;

        // Сначала убедимся, что активный датасет соответствует уровню зума,
        // затем обновим слой (это гарантирует, что для любого поля смена набора произойдёт корректно)
        ensureDatasetByScale();
        updateLayer(field);
    });
});

// ----------------- Popup (используем сохранённый объект соответствия ключей) -----------------
map.on("click", "indexes-layer", (e) => {
    const props = e.features[0].properties;
    const field = currentField;

    // попытка найти реальное имя свойства для popup в кеше
    const propKeyCache = (map.__propertyKeyForPopup || {})[activeDataset + "::" + field];
    const propKey = propKeyCache || resolvePropertyKey(field, DATA_CACHE[activeDataset]);

    let popupContent = "";

    if (field === "Index ZOZh") {
        const idx = Number(props[propKey || "Index ZOZh"]);
        popupContent = `
            <div class="popup-content">
                <h4>Итоговый индекс ЗОЖ</h4>
                <b>${isNaN(idx) ? "-" : idx.toFixed(1)}</b>
                <hr>
                <div>Коммерческий спорт: ${Number(props["norm_n"] || props["norm_n"] || "-")}</div>
                <div>Спортивные площадки: ${Number(props["norm_fitness"] || props["norm_fitness"] || "-")}</div>
                <div>Негативные объекты: ${Number(props["norm_bad"] || props["norm_bad"] || "-")}</div>
                <div>Рекреационная инфраструктура: ${Number(props["norm_park_weighted_avail"] || props["norm_park_weighted_avail"] || "-")}</div>
            </div>
        `;
    } else {
        const val = Number(props[propKey]);
        popupContent = `
            <div class="popup-content">
                <b>${isNaN(val) ? "-" : val.toFixed(1)}</b>
            </div>
        `;
    }

    new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(popupContent)
        .addTo(map);
});







