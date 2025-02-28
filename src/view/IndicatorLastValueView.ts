/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import YAxis from '../component/YAxis'

import { eachFigures, IndicatorFigure, IndicatorFigureStyle } from '../component/Indicator'

import View from './View'

import { formatPrecision, formatThousands } from '../common/utils/format'
import { isValid } from '../common/utils/typeChecks'

export default class IndicatorLastValueView extends View<YAxis> {
  override drawImp (ctx: CanvasRenderingContext2D): void {
    const widget = this.getWidget()
    const pane = widget.getPane()
    const bounding = widget.getBounding()
    const chartStore = pane.getChart().getChartStore()
    const customApi = chartStore.getCustomApi()
    const defaultStyles = chartStore.getStyles().indicator
    const lastValueMarkStyles = defaultStyles.lastValueMark
    const lastValueMarkTextStyles = lastValueMarkStyles.text
    if (lastValueMarkStyles.show) {
      const yAxis = pane.getAxisComponent()
      const dataList = chartStore.getDataList()
      const dataIndex = dataList.length - 1
      const indicators = chartStore.getIndicatorStore().getInstances(pane.getId())
      const thousandsSeparator = chartStore.getThousandsSeparator()
      indicators.forEach(indicator => {
        const result = indicator.result
        const indicatorData = result[dataIndex]
        if (indicatorData !== undefined && indicator.visible) {
          const precision = indicator.precision
          eachFigures(dataList, indicator, dataIndex, defaultStyles, (figure: IndicatorFigure, figureStyles: Required<IndicatorFigureStyle>) => {
            const value = indicatorData[figure.key]
            if (isValid<number>(value)) {
              const y = yAxis.convertToNicePixel(value)
              let text = formatPrecision(value, precision)
              if (indicator.shouldFormatBigNumber) {
                text = customApi.formatBigNumber(text)
              }
              text = formatThousands(text, thousandsSeparator)
              let x: number
              let textAlign: CanvasTextAlign
              if (yAxis.isFromZero()) {
                x = 0
                textAlign = 'left'
              } else {
                x = bounding.width
                textAlign = 'right'
              }

              this.createFigure(
                'text',
                {
                  x,
                  y,
                  text,
                  align: textAlign,
                  baseline: 'middle'
                },
                {
                  ...lastValueMarkTextStyles,
                  backgroundColor: figureStyles.color
                }
              )?.draw(ctx)
            }
          })
        }
      })
    }
  }
}
