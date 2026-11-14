import Chart from "chart.js/auto";
const active = new Map();
export function chartCount() {
  return Object.keys(Chart.instances).length;
}
export function destroyChart(id) {
  const existing = active.get(id);
  if (existing) {
    existing.destroy();
    active.delete(id);
  }
}
function target(id, hasData = true) {
  destroyChart(id);
  const element = document.getElementById(id);
  if (!element) return null;
  if (!hasData) {
    const message = document.createElement("p");
    message.className = "empty";
    message.textContent = "Belum ada data — no results to plot.";
    message.setAttribute("role", "status");
    element.parentElement.replaceChildren(message);
    return null;
  }
  return element;
}
export function clearCharts() {
  for (const id of [...active.keys()]) destroyChart(id);
}
export function chart(
  id,
  labels,
  values,
  type = "bar",
  label = "Count",
  options = {},
) {
  const element = target(
    id,
    options.empty !== true &&
      values.length > 0 &&
      values.some((value) => value !== null && Number.isFinite(value)),
  );
  if (!element) return;
  active.set(
    id,
    new Chart(element, {
      type,
      data: {
        labels,
        datasets: [
          {
            label,
            data: values,
            backgroundColor: [
              "#2563eb",
              "#16a34a",
              "#d97706",
              "#64748b",
              "#1e3a8a",
              "#dc2626",
            ],
            borderWidth: 0,
            borderRadius: type === "bar" ? 5 : 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: type === "doughnut", position: "bottom" },
        },
        scales: type === "doughnut" ? {} : { y: { beginAtZero: true } },
      },
    }),
  );
}
export function curve(id, x, y, label) {
  const element = target(id, x?.length > 0 && y?.length === x?.length);
  if (!element) return;
  active.set(
    id,
    new Chart(element, {
      type: "line",
      data: {
        datasets: [
          {
            label,
            data: x.map((v, i) => ({ x: v, y: y[i] })),
            borderColor: "#2563eb",
            pointRadius: 0,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { type: "linear", min: 0, max: 1 },
          y: { min: 0, max: 1 },
        },
      },
    }),
  );
}

export function featureImportance(id, ranking) {
  const element = target(id, ranking.length > 0);
  if (!element) return;
  active.set(
    id,
    new Chart(element, {
      type: "bar",
      data: {
        labels: ranking.map(([name]) => name),
        datasets: [
          {
            label: "RF impurity importance",
            data: ranking.map(([, value]) => value),
            backgroundColor: "#2563eb",
            borderRadius: 3,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true } },
      },
    }),
  );
}
