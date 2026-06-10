import {
  uid,
  titleSlide,
  type DeckDoc,
  type Slide,
  type SlideElement,
} from "./model";

export interface DeckTemplate {
  id: string;
  name: string;
  subtitle: string;
  accent: string;
  build: () => DeckDoc;
}

function txt(p: Partial<SlideElement>): SlideElement {
  return {
    id: uid(),
    type: "text",
    x: 80,
    y: 80,
    w: 800,
    h: 80,
    fontSize: 18,
    color: "#202124",
    align: "left",
    valign: "top",
    fontFamily: "Arial",
    text: "",
    ...p,
  };
}
function rect(p: Partial<SlideElement>): SlideElement {
  return {
    id: uid(),
    type: "rect",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    fill: "#4285f4",
    stroke: "none",
    strokeWidth: 0,
    ...p,
  };
}

function slide(background: string, elements: SlideElement[]): Slide {
  return { id: uid(), background, elements };
}

// A title + content slide pair used by several templates.
function titleAndContent(accent: string): Slide {
  return slide("#ffffff", [
    rect({ x: 0, y: 0, w: 960, h: 8, fill: accent }),
    txt({
      x: 70,
      y: 60,
      w: 820,
      h: 70,
      text: "Section title",
      fontSize: 34,
      bold: true,
      color: "#202124",
    }),
    txt({
      x: 70,
      y: 160,
      w: 820,
      h: 320,
      text: "• Add your first point\n• Add your second point\n• Add your third point",
      fontSize: 22,
      color: "#3c4043",
    }),
  ]);
}

export const DECK_TEMPLATES: DeckTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    subtitle: "",
    accent: "#4285f4",
    build: () => ({ slides: [titleSlide()] }),
  },
  {
    id: "simple-light",
    name: "Simple Light",
    subtitle: "Presentation",
    accent: "#4285f4",
    build: () => ({
      slides: [
        slide("#ffffff", [
          rect({ x: 0, y: 0, w: 12, h: 540, fill: "#4285f4" }),
          txt({
            x: 80,
            y: 200,
            w: 760,
            h: 90,
            text: "Presentation title",
            fontSize: 46,
            bold: true,
            color: "#202124",
          }),
          txt({
            x: 82,
            y: 300,
            w: 760,
            h: 50,
            text: "Your subtitle here",
            fontSize: 22,
            color: "#5f6368",
          }),
        ]),
        titleAndContent("#4285f4"),
      ],
    }),
  },
  {
    id: "bold-dark",
    name: "Bold Dark",
    subtitle: "Presentation",
    accent: "#ea4335",
    build: () => ({
      slides: [
        slide("#202124", [
          txt({
            x: 80,
            y: 210,
            w: 800,
            h: 90,
            text: "Bold statement",
            fontSize: 52,
            bold: true,
            color: "#ffffff",
            align: "center",
          }),
          txt({
            x: 80,
            y: 320,
            w: 800,
            h: 40,
            text: "A striking subtitle",
            fontSize: 22,
            color: "#bdc1c6",
            align: "center",
          }),
        ]),
        slide("#202124", [
          txt({
            x: 70,
            y: 60,
            w: 820,
            h: 70,
            text: "Section title",
            fontSize: 34,
            bold: true,
            color: "#ffffff",
          }),
          txt({
            x: 70,
            y: 160,
            w: 820,
            h: 320,
            text: "• Point one\n• Point two\n• Point three",
            fontSize: 24,
            color: "#e8eaed",
          }),
        ]),
      ],
    }),
  },
  {
    id: "photo-focus",
    name: "Photo Focus",
    subtitle: "Portfolio",
    accent: "#34a853",
    build: () => ({
      slides: [
        slide("#ffffff", [
          rect({ x: 0, y: 0, w: 480, h: 540, fill: "#e8f0fe" }),
          { id: uid(), type: "image", x: 40, y: 60, w: 400, h: 420, src: "" },
          txt({
            x: 520,
            y: 200,
            w: 400,
            h: 80,
            text: "Project title",
            fontSize: 40,
            bold: true,
            color: "#202124",
          }),
          txt({
            x: 522,
            y: 300,
            w: 400,
            h: 60,
            text: "A short description of the work.",
            fontSize: 20,
            color: "#5f6368",
          }),
        ]),
      ],
    }),
  },
  {
    id: "pitch",
    name: "Pitch Deck",
    subtitle: "Startup",
    accent: "#fbbc04",
    build: () => ({
      slides: [
        slide("#0b3d2e", [
          txt({
            x: 80,
            y: 200,
            w: 800,
            h: 100,
            text: "Company Name",
            fontSize: 56,
            bold: true,
            color: "#ffffff",
          }),
          txt({
            x: 82,
            y: 320,
            w: 800,
            h: 50,
            text: "The one-line pitch",
            fontSize: 24,
            color: "#a7f3d0",
          }),
        ]),
        titleAndContent("#fbbc04"),
        titleAndContent("#fbbc04"),
      ],
    }),
  },
];
