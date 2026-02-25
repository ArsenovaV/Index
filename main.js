// 1️⃣ Инициализация карты
const map = new maplibregl.Map({
    container: "map",
    style: "https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json",
    center: [37.6173, 55.7558],
    zoom: 10,
});


// 2️⃣ После загрузки карты
map.on("load", () => {

    map.addSource("indexes", {
        type: "geojson",
        data: "data/Index.geojson"
    });

    map.addLayer({
        id: "indexes-layer",
        type: "fill",
        source: "indexes",
        paint: {
            "fill-color": "#a86060",
            "fill-opacity": 0.7
        }
    });

    map.addLayer({
        id: "indexes-outline",
        type: "line",
        source: "indexes",
        paint: {
            "line-color": "#333",
            "line-width": 1
        }
    });

    // Ждём полной загрузки данных
    map.once("idle", () => {
        updateLayer("Index ZOZh");
    });
});


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
        "#f7fbff",
        q1, "#c6dbef",
        q2, "#6baed6",
        q3, "#2171b5"
    ];
}


// 5️⃣ Обновление слоя
function updateLayer(field) {

    const features = map.querySourceFeatures("indexes");

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

    const colors = ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5"];

    document.getElementById("c1").style.background = colors[0];
    document.getElementById("c2").style.background = colors[1];
    document.getElementById("c3").style.background = colors[2];
    document.getElementById("c4").style.background = colors[3];

    document.getElementById("l1").innerText = `${min.toFixed(3)} – ${q1.toFixed(3)}`;
    document.getElementById("l2").innerText = `${q1.toFixed(3)} – ${q2.toFixed(3)}`;
    document.getElementById("l3").innerText = `${q2.toFixed(3)} – ${q3.toFixed(3)}`;
    document.getElementById("l4").innerText = `> ${q3.toFixed(3)}`;

    document.getElementById("legend-minmax").innerText =
        `Min: ${min.toFixed(3)} | Max: ${max.toFixed(3)}`;
}


// 7️⃣ Смена показателя
document.getElementById("layer-selector")
    .addEventListener("change", (e) => {
        updateLayer(e.target.value);
});



// 8️⃣ Popup
map.on("click", "indexes-layer", (e) => {

    const props = e.features[0].properties;
    const field = document.getElementById("layer-selector").value;

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