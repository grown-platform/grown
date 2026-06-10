import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandProvider, useBrand } from "./Brand";
import { defaultBrand } from "./defaultBrand";

function ProbeProductName() {
  const b = useBrand();
  return <span data-testid="probe">{b.productName}</span>;
}

describe("BrandProvider", () => {
  // loadOrgBranding is disabled in these unit tests so they exercise only the
  // static default/override merge, with no network fetch.
  it("exposes defaultBrand when no override is passed", () => {
    render(
      <BrandProvider loadOrgBranding={false}>
        <ProbeProductName />
      </BrandProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent(
      defaultBrand.productName,
    );
  });

  it("merges the override brand onto the default", () => {
    render(
      <BrandProvider
        loadOrgBranding={false}
        brand={{ productName: "AcmeCorp Workspace" }}
      >
        <ProbeProductName />
      </BrandProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("AcmeCorp Workspace");
  });

  it("sets CSS custom properties on the root element", () => {
    render(
      <BrandProvider
        loadOrgBranding={false}
        brand={{ primaryColor: "#abcdef" }}
      >
        <ProbeProductName />
      </BrandProvider>,
    );
    // BrandProvider writes CSS vars onto the immediate wrapper element.
    const wrapper = screen.getByTestId("probe").parentElement!;
    expect(wrapper.style.getPropertyValue("--grown-primary")).toBe("#abcdef");
  });
});
