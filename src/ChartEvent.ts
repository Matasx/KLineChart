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

import Nullable from './common/Nullable'
import SyntheticEvent, { EventHandler, MouseTouchEvent, TOUCH_MIN_RADIUS } from './common/SyntheticEvent'
import Coordinate from './common/Coordinate'
import { UpdateLevel } from './common/Updater'
import Bounding from './common/Bounding'
import Crosshair from './common/Crosshair'
import { requestAnimationFrame, cancelAnimationFrame } from './common/utils/compatible'

import { AxisExtremum } from './component/Axis'
import YAxis from './component/YAxis'

import Chart from './Chart'
import Pane, { PaneIdConstants } from './pane/Pane'
import Widget, { WidgetNameConstants } from './widget/Widget'
import { REAL_SEPARATOR_HEIGHT } from './widget/SeparatorWidget'

interface EventTriggerWidgetInfo {
  pane: Nullable<Pane>
  widget: Nullable<Widget>
}

export default class ChartEvent implements EventHandler {
  private readonly _container: HTMLElement
  private readonly _chart: Chart
  private readonly _event: SyntheticEvent

  // 惯性滚动开始时间
  private _flingStartTime = new Date().getTime()
  // 惯性滚动定时器
  private _flingScrollRequestId: Nullable<number> = null
  // 开始滚动时坐标点
  private _startScrollCoordinate: Nullable<Coordinate> = null
  // 开始触摸时坐标
  private _touchCoordinate: Nullable<Coordinate> = null
  // 是否是取消了十字光标
  private _touchCancelCrosshair = false
  // 是否缩放过
  private _touchZoomed = false
  // 用来记录捏合缩放的尺寸
  private _pinchScale = 1

  private _mouseDownWidget: Nullable<Widget> = null

  private _prevYAxisExtremum: Nullable<AxisExtremum> = null

  private _xAxisStartScaleCoordinate: Nullable<Coordinate> = null
  private _xAxisStartScaleDistance = 0
  private _xAxisScale = 1

  private _yAxisStartScaleDistance = 0

  private _mouseMoveTriggerWidgetInfo: EventTriggerWidgetInfo = { pane: null, widget: null }

  private readonly _boundKeyBoardDownEvent: ((event: KeyboardEvent) => void) = (event: KeyboardEvent) => {
    if (event.shiftKey) {
      switch (event.code) {
        case 'Equal': {
          this._chart.getChartStore().getTimeScaleStore().zoom(0.5)
          break
        }
        case 'Minus': {
          this._chart.getChartStore().getTimeScaleStore().zoom(-0.5)
          break
        }
        case 'ArrowLeft': {
          const timeScaleStore = this._chart.getChartStore().getTimeScaleStore()
          timeScaleStore.startScroll()
          timeScaleStore.scroll(-3 * timeScaleStore.getBarSpace().bar)
          break
        }
        case 'ArrowRight': {
          const timeScaleStore = this._chart.getChartStore().getTimeScaleStore()
          timeScaleStore.startScroll()
          timeScaleStore.scroll(3 * timeScaleStore.getBarSpace().bar)
          break
        }
        default: {
          break
        }
      }
    }
  }

  constructor (container: HTMLElement, chart: Chart) {
    this._container = container
    this._chart = chart
    this._event = new SyntheticEvent(container, this, {
      treatVertDragAsPageScroll: () => false,
      treatHorzDragAsPageScroll: () => false
    })
    container.addEventListener('keydown', this._boundKeyBoardDownEvent)
  }

  pinchStartEvent (): boolean {
    this._touchZoomed = true
    this._pinchScale = 1
    return true
  }

  pinchEvent (e: MouseTouchEvent, scale: number): boolean {
    const { pane, widget } = this._findWidgetByEvent(e)
    if (pane?.getId() !== PaneIdConstants.XAXIS && widget?.getName() === WidgetNameConstants.MAIN) {
      const event = this._makeWidgetEvent(e, widget)
      const zoomScale = (scale - this._pinchScale) * 5
      this._pinchScale = scale
      this._chart.getChartStore().getTimeScaleStore().zoom(zoomScale, { x: event.x, y: event.y })
      return true
    }
    return false
  }

  mouseWheelHortEvent (_: MouseTouchEvent, distance: number): boolean {
    const timeScaleStore = this._chart.getChartStore().getTimeScaleStore()
    timeScaleStore.startScroll()
    timeScaleStore.scroll(distance)
    return true
  }

  mouseWheelVertEvent (e: MouseTouchEvent, scale: number): boolean {
    const { widget } = this._findWidgetByEvent(e)
    const isTouch = e.isTouch ?? false
    const event = this._makeWidgetEvent(e, widget)
    let zoomCoordinate: Nullable<Coordinate> = null
    const name = widget?.getName()
    if (isTouch) {
      if (name === WidgetNameConstants.MAIN || name === WidgetNameConstants.XAXIS) {
        zoomCoordinate = { x: event.x, y: event.y }
      } else {
        const bounding = this._chart.getPaneById(PaneIdConstants.CANDLE)?.getBounding() as Bounding
        zoomCoordinate = { x: bounding.width / 2, y: bounding.height / 2 }
      }
    } else {
      if (name === WidgetNameConstants.MAIN) {
        zoomCoordinate = { x: event.x, y: event.y }
      }
    }
    if (zoomCoordinate !== null) {
      this._chart.getChartStore().getTimeScaleStore().zoom(scale, { x: event.x, y: event.y })
      return true
    }
    return false
  }

  mouseDownEvent (e: MouseTouchEvent): boolean {
    const { pane, widget } = this._findWidgetByEvent(e)
    this._mouseDownWidget = widget
    if (widget !== null) {
      const event = this._makeWidgetEvent(e, widget)
      const name = widget.getName()
      switch (name) {
        case WidgetNameConstants.SEPARATOR: {
          return widget.dispatchEvent('mouseDownEvent', event)
        }
        case WidgetNameConstants.MAIN: {
          const extremum = pane?.getAxisComponent().getExtremum() ?? null
          this._prevYAxisExtremum = extremum === null ? extremum : { ...extremum }
          this._startScrollCoordinate = { x: event.x, y: event.y }
          this._chart.getChartStore().getTimeScaleStore().startScroll()
          return widget.dispatchEvent('mouseDownEvent', event)
        }
        case WidgetNameConstants.XAXIS: {
          const consumed = widget.dispatchEvent('mouseDownEvent', event)
          if (consumed) {
            this._chart.updatePane(UpdateLevel.Overlay)
          }
          this._xAxisStartScaleCoordinate = { x: event.x, y: event.y }
          this._xAxisStartScaleDistance = event.pageX
          return consumed
        }
        case WidgetNameConstants.YAXIS: {
          const consumed = widget.dispatchEvent('mouseDownEvent', event)
          if (consumed) {
            this._chart.updatePane(UpdateLevel.Overlay)
          }
          const extremum = pane?.getAxisComponent().getExtremum() ?? null
          this._prevYAxisExtremum = extremum === null ? extremum : { ...extremum }
          this._yAxisStartScaleDistance = event.pageY
          return consumed
        }
      }
    }
    return false
  }

  mouseMoveEvent (e: MouseTouchEvent): boolean {
    const { pane, widget } = this._findWidgetByEvent(e)
    const event = this._makeWidgetEvent(e, widget)
    if (
      this._mouseMoveTriggerWidgetInfo.pane?.getId() !== pane?.getId() ||
      this._mouseMoveTriggerWidgetInfo.widget?.getName() !== widget?.getName()
    ) {
      widget?.dispatchEvent('mouseEnterEvent', event)
      this._mouseMoveTriggerWidgetInfo.widget?.dispatchEvent('mouseLeaveEvent', event)
      this._mouseMoveTriggerWidgetInfo = { pane, widget }
    }
    if (widget !== null) {
      const name = widget.getName()
      switch (name) {
        case WidgetNameConstants.MAIN: {
          const consumed = widget.dispatchEvent('mouseMoveEvent', event)
          const chartStore = this._chart.getChartStore()
          let crosshair: Crosshair | undefined = { x: event.x, y: event.y, paneId: pane?.getId() }
          if (consumed && chartStore.getTooltipStore().getActiveIcon() !== null) {
            crosshair = undefined
            if (widget !== null) {
              widget.getContainer().style.cursor = 'pointer'
            }
          }
          this._chart.getChartStore().getTooltipStore().setCrosshair(crosshair)
          return consumed
        }
        case WidgetNameConstants.SEPARATOR:
        case WidgetNameConstants.XAXIS:
        case WidgetNameConstants.YAXIS: {
          const consumed = widget.dispatchEvent('mouseMoveEvent', event)
          this._chart.getChartStore().getTooltipStore().setCrosshair()
          return consumed
        }
      }
    }
    return false
  }

  pressedMouseMoveEvent (e: MouseTouchEvent): boolean {
    if (this._mouseDownWidget !== null && this._mouseDownWidget.getName() === WidgetNameConstants.SEPARATOR) {
      return this._mouseDownWidget.dispatchEvent('pressedMouseMoveEvent', e)
    }
    const { pane, widget } = this._findWidgetByEvent(e)
    if (
      widget !== null &&
      this._mouseDownWidget?.getPane().getId() === pane?.getId() &&
      this._mouseDownWidget?.getName() === widget.getName()
    ) {
      const event = this._makeWidgetEvent(e, widget)
      const name = widget.getName()
      switch (name) {
        case WidgetNameConstants.MAIN: {
          const bounding = widget.getBounding()
          const consumed = widget.dispatchEvent('pressedMouseMoveEvent', event)
          if (!consumed && this._startScrollCoordinate !== null) {
            const yAxis = pane?.getAxisComponent() as YAxis
            if (this._prevYAxisExtremum !== null && !yAxis.getAutoCalcTickFlag() && yAxis.getScrollZoomEnabled()) {
              const { min, max, range } = this._prevYAxisExtremum
              let distance: number
              if (yAxis?.isReverse() ?? false) {
                distance = this._startScrollCoordinate.y - event.y
              } else {
                distance = event.y - this._startScrollCoordinate.y
              }
              const scale = distance / bounding.height
              const difRange = range * scale
              const newMin = min + difRange
              const newMax = max + difRange
              const newRealMin = yAxis.convertToRealValue(newMin)
              const newRealMax = yAxis.convertToRealValue(newMax)
              yAxis.setExtremum({
                min: newMin,
                max: newMax,
                range: newMax - newMin,
                realMin: newRealMin,
                realMax: newRealMax,
                realRange: newRealMax - newRealMin
              })
            }
            const distance = event.x - this._startScrollCoordinate.x
            this._chart.getChartStore().getTimeScaleStore().scroll(distance)
          }
          this._chart.getChartStore().getTooltipStore().setCrosshair({ x: event.x, y: event.y, paneId: pane?.getId() })
          return consumed
        }
        case WidgetNameConstants.XAXIS: {
          const consumed = widget.dispatchEvent('pressedMouseMoveEvent', event)
          if (!consumed) {
            const xAxis = pane?.getAxisComponent()
            if (xAxis?.getScrollZoomEnabled() ?? true) {
              const scale = this._xAxisStartScaleDistance / event.pageX
              const zoomScale = (scale - this._xAxisScale) * 10
              this._xAxisScale = scale
              this._chart.getChartStore().getTimeScaleStore().zoom(zoomScale, this._xAxisStartScaleCoordinate ?? undefined)
            }
          } else {
            this._chart.updatePane(UpdateLevel.Overlay)
          }
          return consumed
        }
        case WidgetNameConstants.YAXIS: {
          const consumed = widget.dispatchEvent('pressedMouseMoveEvent', event)
          if (!consumed) {
            const yAxis = pane?.getAxisComponent() as YAxis
            if (this._prevYAxisExtremum !== null && yAxis.getScrollZoomEnabled()) {
              const { min, max, range } = this._prevYAxisExtremum
              const scale = event.pageY / this._yAxisStartScaleDistance
              const newRange = range * scale
              const difRange = (newRange - range) / 2
              const newMin = min - difRange
              const newMax = max + difRange
              const yAxis = pane?.getAxisComponent() as YAxis
              const newRealMin = yAxis.convertToRealValue(newMin)
              const newRealMax = yAxis.convertToRealValue(newMax)
              yAxis.setExtremum({
                min: newMin,
                max: newMax,
                range: newRange,
                realMin: newRealMin,
                realMax: newRealMax,
                realRange: newRealMax - newRealMin
              })
              this._chart.adjustPaneViewport(false, true, true, true)
            }
          } else {
            this._chart.updatePane(UpdateLevel.Overlay)
          }
          return consumed
        }
      }
    }
    return false
  }

  mouseUpEvent (e: MouseTouchEvent): boolean {
    const { widget } = this._findWidgetByEvent(e)
    let consumed: boolean = false
    if (widget !== null) {
      const event = this._makeWidgetEvent(e, widget)
      const name = widget.getName()
      switch (name) {
        case WidgetNameConstants.MAIN:
        case WidgetNameConstants.SEPARATOR:
        case WidgetNameConstants.XAXIS:
        case WidgetNameConstants.YAXIS: {
          consumed = widget.dispatchEvent('mouseUpEvent', event)
          break
        }
      }
      if (consumed) {
        this._chart.updatePane(UpdateLevel.Overlay)
      }
    }
    this._mouseDownWidget = null
    this._startScrollCoordinate = null
    this._prevYAxisExtremum = null
    this._xAxisStartScaleCoordinate = null
    this._xAxisStartScaleDistance = 0
    this._xAxisScale = 1
    this._yAxisStartScaleDistance = 0
    return consumed
  }

  mouseClickEvent (e: MouseTouchEvent): boolean {
    const { widget } = this._findWidgetByEvent(e)
    if (widget !== null) {
      const event = this._makeWidgetEvent(e, widget)
      return widget.dispatchEvent('mouseClickEvent', event)
    }
    return false
  }

  mouseRightClickEvent (e: MouseTouchEvent): boolean {
    const { widget } = this._findWidgetByEvent(e)
    let consumed: boolean = false
    if (widget !== null) {
      const event = this._makeWidgetEvent(e, widget)
      const name = widget.getName()
      switch (name) {
        case WidgetNameConstants.MAIN:
        case WidgetNameConstants.XAXIS:
        case WidgetNameConstants.YAXIS: {
          consumed = widget.dispatchEvent('mouseRightClickEvent', event)
          break
        }
      }
      if (consumed) {
        this._chart.updatePane(UpdateLevel.Overlay)
      }
    }
    return false
  }

  mouseDoubleClickEvent (e: MouseTouchEvent): boolean {
    const { pane, widget } = this._findWidgetByEvent(e)
    if (widget !== null) {
      const name = widget.getName()
      switch (name) {
        case WidgetNameConstants.MAIN: {
          const event = this._makeWidgetEvent(e, widget)
          return widget.dispatchEvent('mouseDoubleClickEvent', event)
        }
        case WidgetNameConstants.YAXIS: {
          const yAxis = pane?.getAxisComponent() as YAxis
          if (!yAxis.getAutoCalcTickFlag()) {
            yAxis.setAutoCalcTickFlag(true)
            this._chart.adjustPaneViewport(false, true, true, true)
            return true
          }
          break
        }
      }
    }
    return false
  }

  mouseLeaveEvent (): boolean {
    this._chart.getChartStore().getTooltipStore().setCrosshair()
    return true
  }

  touchStartEvent (e: MouseTouchEvent): boolean {
    const { pane, widget } = this._findWidgetByEvent(e)
    if (widget !== null) {
      const event = this._makeWidgetEvent(e, widget)
      const name = widget.getName()
      switch (name) {
        case WidgetNameConstants.MAIN: {
          const chartStore = this._chart.getChartStore()
          const tooltipStore = chartStore.getTooltipStore()
          if (widget.dispatchEvent('mouseDownEvent', event)) {
            this._touchCancelCrosshair = true
            this._touchCoordinate = null
            tooltipStore.setCrosshair(undefined, true)
            this._chart.updatePane(UpdateLevel.Overlay)
            return true
          }
          if (this._flingScrollRequestId !== null) {
            cancelAnimationFrame(this._flingScrollRequestId)
            this._flingScrollRequestId = null
          }
          this._flingStartTime = new Date().getTime()
          this._startScrollCoordinate = { x: event.x, y: event.y }
          chartStore.getTimeScaleStore().startScroll()
          this._touchZoomed = false
          if (this._touchCoordinate !== null) {
            const xDif = event.x - this._touchCoordinate.x
            const yDif = event.y - this._touchCoordinate.y
            const radius = Math.sqrt(xDif * xDif + yDif * yDif)
            if (radius < TOUCH_MIN_RADIUS) {
              this._touchCoordinate = { x: event.x, y: event.y }
              tooltipStore.setCrosshair({ x: event.x, y: event.y, paneId: pane?.getId() })
            } else {
              this._touchCoordinate = null
              this._touchCancelCrosshair = true
              tooltipStore.setCrosshair()
            }
          }
          return true
        }
        case WidgetNameConstants.XAXIS:
        case WidgetNameConstants.YAXIS: {
          const consumed = widget.dispatchEvent('mouseDownEvent', event)
          if (consumed) {
            this._chart.updatePane(UpdateLevel.Overlay)
          }
          return consumed
        }
      }
    }
    return false
  }

  touchMoveEvent (e: MouseTouchEvent): boolean {
    const { pane, widget } = this._findWidgetByEvent(e)
    if (widget !== null) {
      const event = this._makeWidgetEvent(e, widget)
      const name = widget.getName()
      const chartStore = this._chart.getChartStore()
      const tooltipStore = chartStore.getTooltipStore()
      switch (name) {
        case WidgetNameConstants.MAIN: {
          if (widget.dispatchEvent('pressedMouseMoveEvent', event)) {
            event.preventDefault?.()
            tooltipStore.setCrosshair(undefined, true)
            this._chart.updatePane(UpdateLevel.Overlay)
            return true
          }
          if (this._touchCoordinate !== null) {
            event.preventDefault?.()
            tooltipStore.setCrosshair({ x: event.x, y: event.y, paneId: pane?.getId() })
          } else {
            if (
              this._startScrollCoordinate !== null &&
              Math.abs(this._startScrollCoordinate.x - event.x) > this._startScrollCoordinate.y - event.y
            ) {
              const distance = event.x - this._startScrollCoordinate.x
              chartStore.getTimeScaleStore().scroll(distance)
            }
          }
          return true
        }
        case WidgetNameConstants.XAXIS:
        case WidgetNameConstants.YAXIS: {
          const consumed = widget.dispatchEvent('pressedMouseMoveEvent', event)
          if (consumed) {
            event.preventDefault?.()
            this._chart.updatePane(UpdateLevel.Overlay)
          }
          return consumed
        }
      }
    }
    return false
  }

  touchEndEvent (e: MouseTouchEvent): boolean {
    const { widget } = this._findWidgetByEvent(e)
    if (widget !== null) {
      const event = this._makeWidgetEvent(e, widget)
      const name = widget.getName()
      switch (name) {
        case WidgetNameConstants.MAIN: {
          widget.dispatchEvent('mouseUpEvent', event)
          if (this._startScrollCoordinate !== null) {
            const time = new Date().getTime() - this._flingStartTime
            const distance = event.x - this._startScrollCoordinate.x
            let v = distance / (time > 0 ? time : 1) * 20
            if (time < 200 && Math.abs(v) > 0) {
              const timeScaleStore = this._chart.getChartStore().getTimeScaleStore()
              const flingScroll: (() => void) = () => {
                this._flingScrollRequestId = requestAnimationFrame(() => {
                  timeScaleStore.startScroll()
                  timeScaleStore.scroll(v)
                  v = v * (1 - 0.025)
                  if (Math.abs(v) < 1) {
                    if (this._flingScrollRequestId !== null) {
                      cancelAnimationFrame(this._flingScrollRequestId)
                      this._flingScrollRequestId = null
                    }
                  } else {
                    flingScroll()
                  }
                })
              }
              flingScroll()
            }
          }
          return true
        }
        case WidgetNameConstants.XAXIS:
        case WidgetNameConstants.YAXIS: {
          const consumed = widget.dispatchEvent('mouseUpEvent', event)
          if (consumed) {
            this._chart.updatePane(UpdateLevel.Overlay)
          }
        }
      }
    }
    return false
  }

  tapEvent (e: MouseTouchEvent): boolean {
    const { pane, widget } = this._findWidgetByEvent(e)
    let consumed = false
    if (widget !== null) {
      const event = this._makeWidgetEvent(e, widget)
      const result = widget.dispatchEvent('mouseClickEvent', event)
      if (widget.getName() === WidgetNameConstants.MAIN) {
        const event = this._makeWidgetEvent(e, widget)
        const chartStore = this._chart.getChartStore()
        const tooltipStore = chartStore.getTooltipStore()
        if (result) {
          this._touchCancelCrosshair = true
          this._touchCoordinate = null
          tooltipStore.setCrosshair(undefined, true)
          consumed = true
        } else {
          if (!this._touchCancelCrosshair && !this._touchZoomed) {
            this._touchCoordinate = { x: event.x, y: event.y }
            tooltipStore.setCrosshair({ x: event.x, y: event.y, paneId: pane?.getId() }, true)
            consumed = true
          }
          this._touchCancelCrosshair = false
        }
      }
      if (consumed || result) {
        this._chart.updatePane(UpdateLevel.Overlay)
      }
    }
    return consumed
  }

  doubleTapEvent (e: MouseTouchEvent): boolean {
    return this.mouseDoubleClickEvent(e)
  }

  longTapEvent (e: MouseTouchEvent): boolean {
    const { pane, widget } = this._findWidgetByEvent(e)
    if (widget !== null && widget.getName() === WidgetNameConstants.MAIN) {
      const event = this._makeWidgetEvent(e, widget)
      this._touchCoordinate = { x: event.x, y: event.y }
      this._chart.getChartStore().getTooltipStore().setCrosshair({ x: event.x, y: event.y, paneId: pane?.getId() })
      return true
    }
    return false
  }

  private _findWidgetByEvent (event: MouseTouchEvent): EventTriggerWidgetInfo {
    const panes = this._chart.getAllPanes()
    const { x, y } = event
    let pane: Nullable<Pane> = null
    for (const [, p] of panes) {
      const bounding = p.getBounding()
      if (
        x >= bounding.left && x <= bounding.left + bounding.width &&
        y >= bounding.top && y <= bounding.top + bounding.height
      ) {
        pane = p
        break
      }
    }
    if (pane === null) {
      pane = this._chart.getPaneById(PaneIdConstants.XAXIS)
    }
    let widget: Nullable<Widget> = null
    if (pane !== null) {
      const separatorWidget = pane.getSeparatorWidget()
      if (separatorWidget !== null) {
        const separatorBounding = separatorWidget.getBounding()
        if (
          x >= separatorBounding.left && x <= separatorBounding.left + separatorBounding.width &&
          y >= separatorBounding.top && y <= (separatorBounding.top + REAL_SEPARATOR_HEIGHT)
        ) {
          widget = separatorWidget
        }
      }
      if (widget === null) {
        const mainWidget = pane.getMainWidget()
        const mainBounding = mainWidget.getBounding()
        if (
          x >= mainBounding.left && x <= mainBounding.left + mainBounding.width &&
          y >= mainBounding.top && y <= mainBounding.top + mainBounding.height
        ) {
          widget = mainWidget
        }
      }
      if (widget === null) {
        const yAxisWidget = pane.getYAxisWidget()
        if (yAxisWidget !== null) {
          const yAxisBounding = yAxisWidget.getBounding()
          if (
            x >= yAxisBounding.left && x <= yAxisBounding.left + yAxisBounding.width &&
            y >= yAxisBounding.top && y <= yAxisBounding.top + yAxisBounding.height
          ) {
            widget = yAxisWidget
          }
        }
      }
    }
    return { pane, widget }
  }

  private _makeWidgetEvent (event: MouseTouchEvent, widget: Nullable<Widget>): MouseTouchEvent {
    const bounding = widget?.getBounding() ?? null
    return {
      ...event,
      x: event.x - (bounding?.left ?? 0),
      y: event.y - (bounding?.top ?? 0)
    }
  }

  destroy (): void {
    this._container.removeEventListener('keydown', this._boundKeyBoardDownEvent)
    this._event.destroy()
  }
}
