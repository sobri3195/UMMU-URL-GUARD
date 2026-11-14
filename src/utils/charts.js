import Chart from "chart.js/auto";
const active = [];
export function clearCharts() {
  active.splice(0).forEach((chart) => chart.destroy());
}
export function chart(id, labels, values, type = "bar", label = "Count") {
  const element = document.getElementById(id);
  if (!element) return;
  if (!values.length || values.every((v) => v === 0))
    element.parentElement.dataset.empty = "Belum ada data";
  active.push(
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
  if (!document.getElementById(id)) return;
  active.push(
    new Chart(document.getElementById(id), {
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
