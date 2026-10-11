import DaedalusParser = require('daedalus-parser');

const parser = new DaedalusParser();

const parseResult = parser.parse('instance Test (Base) { name = "test"; };', { bufferSize: 2048 });
parseResult.hasErrors;
parseResult.parseTime;
parseResult.throughput;

const parseFileResult = parser.parseFile('examples/DEV_2130_Szmyk.d', {
  encoding: 'utf-8',
  detectEncoding: false,
  bufferSize: 4096
});
parseFileResult.encoding;
parseFileResult.encodingConfidence;

const validation = parser.validate('instance Test (Base) { name = "test"; };');
validation.isValid;
validation.parseTime;
validation.throughput;
validation.errors;

const parserFromFactory = DaedalusParser.create();
parserFromFactory.parse('func void Test() { return; };');

const staticParseResult = DaedalusParser.parseSource('func void Test() { return; };');
staticParseResult.rootNode;

// @ts-expect-error legacy method is intentionally not part of public contract
parser.interpretDialogs(parseResult);

// @ts-expect-error warnings are not part of current validation result
validation.warnings;
