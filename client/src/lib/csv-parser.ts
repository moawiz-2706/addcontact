/**
 * CSV Parser Utility
 * 
 * Handles parsing CSV files, detecting columns, and mapping them
 * to the required contact fields.
 */

export interface ParsedCSV {
  headers: string[];
  rows: string[][];
  fileName: string;
  totalRows: number;
}

export interface ColumnMapping {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
}

export interface MappedContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/**
 * Parse a CSV file and return structured data
 */
export function parseCSV(text: string, fileName: string): ParsedCSV {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  
  if (lines.length < 2) {
    throw new Error('CSV file must contain at least a header row and one data row');
  }

  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((line) => parseCSVLine(line));

  // Filter out rows that are completely empty
  const validRows = rows.filter((row) => row.some((cell) => cell.trim() !== ''));

  return {
    headers,
    rows: validRows,
    fileName,
    totalRows: validRows.length,
  };
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Auto-detect column mappings based on header names
 */
export function autoDetectMappings(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  // Detect first name
  const firstNameIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'first name' ||
      h === 'firstname' ||
      h === 'first_name' ||
      h === 'fname'
  );
  if (firstNameIdx >= 0) mapping.firstName = headers[firstNameIdx];

  // Detect last name
  const lastNameIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'last name' ||
      h === 'lastname' ||
      h === 'last_name' ||
      h === 'lname'
  );
  if (lastNameIdx >= 0) mapping.lastName = headers[lastNameIdx];

  // Detect full name
  const fullNameIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'full name' ||
      h === 'fullname' ||
      h === 'full_name' ||
      h === 'name' ||
      h === 'contact name'
  );
  if (fullNameIdx >= 0) mapping.fullName = headers[fullNameIdx];

  // Detect email
  const emailIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'email' ||
      h === 'email address' ||
      h === 'emailaddress' ||
      h === 'e-mail'
  );
  if (emailIdx >= 0) mapping.email = headers[emailIdx];

  // Detect phone
  const phoneIdx = lowerHeaders.findIndex(
    (h) =>
      h === 'phone' ||
      h === 'phone number' ||
      h === 'phonenumber' ||
      h === 'phone_number' ||
      h === 'mobile' ||
      h === 'cell' ||
      h === 'telephone'
  );
  if (phoneIdx >= 0) mapping.phone = headers[phoneIdx];

  return mapping;
}

/**
 * Apply column mappings to parsed CSV rows to produce contact objects
 */
export function applyMappings(
  parsedCSV: ParsedCSV,
  mapping: ColumnMapping
): MappedContact[] {
  const { headers, rows } = parsedCSV;

  return rows.map((row) => {
    const getVal = (header?: string) => {
      if (!header) return '';
      const idx = headers.indexOf(header);
      return idx >= 0 ? (row[idx] || '').trim() : '';
    };

    let firstName = getVal(mapping.firstName);
    let lastName = getVal(mapping.lastName);

    // If full name is mapped but first/last aren't, split the full name
    if (mapping.fullName && (!firstName || !lastName)) {
      const fullName = getVal(mapping.fullName);
      const parts = fullName.split(/\s+/);
      if (!firstName) firstName = parts[0] || '';
      if (!lastName) lastName = parts.slice(1).join(' ') || '';
    }

    return {
      firstName,
      lastName,
      email: getVal(mapping.email),
      phone: getVal(mapping.phone),
    };
  });
}

/**
 * Validate that required mappings are present
 */
export function validateMappings(mapping: ColumnMapping): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // At least one name field required
  if (!mapping.firstName && !mapping.fullName) {
    errors.push('At least First Name or Full Name must be mapped');
  }

  // At least one contact method required
  if (!mapping.email && !mapping.phone) {
    errors.push('At least Email or Phone Number must be mapped');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
