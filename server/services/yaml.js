function stringify(obj, indent = 0) {
  const prefix = ' '.repeat(indent);
  let result = '';

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result += `${prefix}${key}:\n`;
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      result += `${prefix}${key}:\n`;
      result += stringify(value, indent + 2);
    } else if (Array.isArray(value)) {
      result += `${prefix}${key}:\n`;
      value.forEach(item => {
        result += `${prefix}  - ${item}\n`;
      });
    } else {
      result += `${prefix}${key}: ${value}\n`;
    }
  }

  return result;
}

module.exports = { stringify };
