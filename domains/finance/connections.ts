/** Places Sage, Xero, Payday and Hotelkit will connect.
 *  No account is signed in. Nothing here calls an API or holds a secret. */

export const CONNECTION_STATUS = "not_connected" as const;

export type ExternalConnection = {
  code: "sage" | "xero" | "payday" | "hotelkit";
  name: string;
  product: string;
  site: string | null;
  status: typeof CONNECTION_STATUS;
  detail: string;
};

export const EXTERNAL_CONNECTIONS: ExternalConnection[] = [
  {
    code: "sage",
    name: "Sage",
    product: "Accounts",
    site: "https://www.sage.com/en-gb/",
    status: CONNECTION_STATUS,
    detail: "A signed-in Sage account is still needed before anything can sync.",
  },
  {
    code: "xero",
    name: "Xero",
    product: "Accounts",
    site: "https://www.xero.com/uk/",
    status: CONNECTION_STATUS,
    detail: "A signed-in Xero account is still needed before anything can sync.",
  },
  {
    code: "payday",
    name: "Payday",
    product: "UK payroll",
    site: null,
    status: CONNECTION_STATUS,
    detail: "Payday is the UK payroll product. A signed-in Payday account is still needed before anything can sync.",
  },
  {
    code: "hotelkit",
    name: "Hotelkit",
    product: "Hotel operations at hotelkit.net",
    site: "https://hotelkit.net/",
    status: CONNECTION_STATUS,
    detail: "A signed-in Hotelkit account is still needed before anything can sync.",
  },
];
