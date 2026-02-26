// 1️⃣ Инициализация карты
const map = new maplibregl.Map({
    container: "map",
    style: "https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json",
    center: [37.6173, 55.7558],
    zoom: 10,
});

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

let currentField = "Index ZOZh";

const DETAIL_DISTANCE_THRESHOLD_METERS = 5000;
const DATASET_PATHS = {
    detailed: new URL("./data/Index.geojson", window.location.href).toString(),
    aggregated: new URL("./data/Index_5km.geojson", window.location.href).toString()
};

let activeDataset = "detailed";

// 2️⃣ После загрузки карты
map.on("load", () => {

    map.addSource("indexes", {
        type: "geojson",
        data: DATASET_PATHS.detailed
    });

    map.addLayer({
        id: "indexes-layer",
        type: "fill",
        source: "indexes",
        paint: {
            "fill-color": "#ffffff",
            "fill-opacity": 0.7
        }
    });

    map.addLayer({
        id: "indexes-outline",
        type: "line",
        source: "indexes",
        paint: {
            "line-color": "#ffffff",
            "line-width": 0
        }
    });

    // 2️⃣ Слой с административными границами
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
    }, "indexes-layer"); // добавляем **перед** слоями с индексами

    // Переключаем источник данных в зависимости от масштаба
    map.on("moveend", () => {
        ensureDatasetByScale();
    });

    // Ждём полной загрузки данных
    map.once("idle", () => {
        ensureDatasetByScale();
    });
});



function getVisibleWidthMeters() {

    const bounds = map.getBounds();

    const west = bounds.getWest();
    const east = bounds.getEast();
    const lat = map.getCenter().lat;

    const p1 = new maplibregl.LngLat(west, lat);
    const p2 = new maplibregl.LngLat(east, lat);

    return p1.distanceTo(p2);
}

function ensureDatasetByScale() {

    const useAggregated =
        getVisibleWidthMeters() > DETAIL_DISTANCE_THRESHOLD_METERS;

    const nextDataset = useAggregated ? "aggregated" : "detailed";

    if (nextDataset === activeDataset) {
        return;
    }

    activeDataset = nextDataset;

    map.getSource("indexes").setData(DATASET_PATHS[nextDataset]);

    map.once("data", () => {
        updateLayer(currentField);
    });
}


// 3️⃣ Расчёт квартилей
function calculateQuartiles(values) {

    values.sort((a, b) => a - b);

    const q1 = values[Math.floor(values.length * 0.25)];
    const q2 = values[Math.floor(values.length * 0.50)];
    const q3 = values[Math.floor(values.length * 0.75)];

    return { q1, q2, q3 };
}


// 4️⃣ Цветовое выражение (4 класса)
function getQuartileExpression(field, q1, q2, q3) {

    return [
        "step",
        ["get", field],
        "#FCFAFF",
        q1, "#D8C7F1",
        q2, "#8471A9",
        q3, "#301E67"
    ];
}


// 5️⃣ Обновление слоя
function updateLayer(field) {

    const source = map.getSource("indexes");
    if (!source || !source._data) return;

    const features = source._data.features;

    const values = features
        .map(f => Number(f.properties[field]))
        .filter(v => !isNaN(v));

    if (values.length === 0) return;

    const min = Math.min(...values);
    const max = Math.max(...values);

    const { q1, q2, q3 } = calculateQuartiles(values);

    const expression = getQuartileExpression(field, q1, q2, q3);

    map.setPaintProperty("indexes-layer", "fill-color", expression);

    updateLegend(field, min, max, q1, q2, q3);
}


// 6️⃣ Легенда
function updateLegend(field, min, max, q1, q2, q3) {

    const titles = {
        "Index ZOZh": "Итоговый индекс ЗОЖ",
        "norm_n": "Коммерческий спорт",
        "norm_fitness": "Спортивные площадки",
        "norm_bad": "Негативные объекты",
        "norm_park_weighted_avail": "Рекреационная инфраструктура"
    };

    document.getElementById("legend-title").innerText = titles[field];

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


// 7️⃣ Смена показателя
// раскрытие панелей
document.querySelectorAll(".panel-title").forEach(title => {
    title.addEventListener("click", () => {
        const panel = title.parentElement;
        panel.classList.toggle("active");
    });
});

// переключение показателей
document.querySelectorAll(".indicator").forEach(item => {
    item.addEventListener("click", () => {

        document.querySelectorAll(".indicator")
            .forEach(i => i.classList.remove("active"));

        item.classList.add("active");

        const field = item.dataset.field;
        currentField = field;
        updateLayer(field);
    });
});



// 8️⃣ Popup
map.on("click", "indexes-layer", (e) => {

    const props = e.features[0].properties;
    const field = currentField;

    let popupContent = "";

    if (field === "Index ZOZh") {

        popupContent = `
            <div class="popup-content">
                <h4>Итоговый индекс ЗОЖ</h4>
                <b>${Number(props["Index ZOZh"]).toFixed(1)}</b>
                <hr>
                <div>Коммерческий спорт: ${Number(props["norm_n"]).toFixed(1)}</div>
                <div>Спортивные площадки: ${Number(props["norm_fitness"]).toFixed(1)}</div>
                <div>Негативные объекты: ${Number(props["norm_bad"]).toFixed(1)}</div>
                <div>Рекреационная инфраструктура: ${Number(props["norm_park_weighted_avail"]).toFixed(1)}</div>
            </div>
        `;

    } else {

        popupContent = `
            <div class="popup-content">
                <b>${Number(props[field]).toFixed(1)}</b>
            </div>
        `;
    }

    new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(popupContent)
        .addTo(map);

});





