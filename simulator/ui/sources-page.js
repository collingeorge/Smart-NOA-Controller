import { SOURCES, LIBRARY_NOTES } from '../data/drugs.js';
import { renderSourceRegistry } from './sources.js';

renderSourceRegistry({ SOURCES, LIBRARY_NOTES }, document.getElementById('source-register'), { standalone: true });
document.getElementById(location.hash.slice(1))?.scrollIntoView();
