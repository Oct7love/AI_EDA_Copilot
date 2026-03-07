import type { ProjectTemplate } from '../types/template.types';

/** V1 预设模板：对齐 PRD §5.1.3 */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'esp32-sensor',
    name: 'ESP32 Sensor Project',
    description: 'Wi-Fi/BLE sensor node with environmental monitoring',
    icon: '📡',
    prefilledData: {
      mcu: 'ESP32-WROOM-32',
      power: '3.3V LDO from USB or Li-Po battery',
      communication: ['Wi-Fi', 'BLE'],
      sensors: ['DHT22', 'BMP280'],
      display: 'SSD1306 OLED 0.96"',
      productionIntent: 'prototype',
    },
  },
  {
    id: 'stm32-controller',
    name: 'STM32 Controller Board',
    description: 'General-purpose MCU board with multiple I/O interfaces',
    icon: '🎛️',
    prefilledData: {
      mcu: 'STM32F103C8T6',
      power: '3.3V LDO from 5V USB',
      communication: ['UART', 'SPI', 'I2C'],
      sensors: [],
      display: '',
      productionIntent: 'prototype',
    },
  },
  {
    id: 'oled-display',
    name: 'OLED Display Board',
    description: 'Small display module with I2C/SPI interface',
    icon: '🖥️',
    prefilledData: {
      mcu: 'ESP32-C3',
      power: '3.3V from USB-C',
      communication: ['I2C'],
      sensors: [],
      display: 'SSD1306 OLED 1.3"',
      productionIntent: 'prototype',
    },
  },
  {
    id: 'battery-powered',
    name: 'Battery-Powered Board',
    description: 'Low-power design with Li-Po charging and sleep modes',
    icon: '🔋',
    prefilledData: {
      mcu: 'ESP32-S3',
      power: 'Li-Po 3.7V with TP4056 charging + ME6211 3.3V LDO',
      communication: ['BLE'],
      sensors: [],
      display: '',
      powerConsumption: 'Target < 10mA active, < 10μA deep sleep',
      productionIntent: 'prototype',
    },
  },
  {
    id: 'power-module',
    name: 'Power Supply Module',
    description: 'Voltage regulation module with multiple output rails',
    icon: '⚡',
    prefilledData: {
      mcu: '',
      power: '12V input → 5V (DC-DC) + 3.3V (LDO) output',
      communication: [],
      sensors: [],
      display: '',
      productionIntent: 'small_batch',
    },
  },
];
