document.addEventListener("DOMContentLoaded", () => {
  const carrossel = document.querySelector(".carrossel-home");
  if (!carrossel) return;

  const trilho = carrossel.querySelector(".trilho-banner");
  const slides = [...carrossel.querySelectorAll(".slide-banner")];
  const indicadores = [...carrossel.querySelectorAll(".indicadores-banner button")];
  const anterior = carrossel.querySelector(".controle-banner.anterior");
  const proximo = carrossel.querySelector(".controle-banner.proximo");
  const reduzirMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let slideAtual = 0;
  let temporizador;

  function mostrarSlide(indice) {
    slideAtual = (indice + slides.length) % slides.length;
    trilho.style.transform = `translateX(-${slideAtual * 100}%)`;

    slides.forEach((slide, i) => {
      const ativo = i === slideAtual;
      slide.classList.toggle("ativo", ativo);
      slide.setAttribute("aria-hidden", String(!ativo));
      indicadores[i].classList.toggle("ativo", ativo);
      indicadores[i].setAttribute("aria-current", String(ativo));
    });
  }

  function iniciarAutomatico() {
    window.clearInterval(temporizador);
    if (!reduzirMovimento) {
      temporizador = window.setInterval(() => mostrarSlide(slideAtual + 1), 5000);
    }
  }

  anterior.addEventListener("click", () => {
    mostrarSlide(slideAtual - 1);
    iniciarAutomatico();
  });

  proximo.addEventListener("click", () => {
    mostrarSlide(slideAtual + 1);
    iniciarAutomatico();
  });

  indicadores.forEach((indicador, indice) => {
    indicador.addEventListener("click", () => {
      mostrarSlide(indice);
      iniciarAutomatico();
    });
  });

  carrossel.addEventListener("mouseenter", () => window.clearInterval(temporizador));
  carrossel.addEventListener("mouseleave", iniciarAutomatico);
  carrossel.addEventListener("focusin", () => window.clearInterval(temporizador));
  carrossel.addEventListener("focusout", iniciarAutomatico);

  mostrarSlide(0);
  iniciarAutomatico();
});
