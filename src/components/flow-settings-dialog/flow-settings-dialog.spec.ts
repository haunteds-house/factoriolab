import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { FlowDiagram } from '~/state/preferences/flow-diagram';
import { initialPreferencesState } from '~/state/preferences/preferences-state';
import { TestModule } from '~/tests/test-module';

import { FlowSettingsDialog } from './flow-settings-dialog';

describe('FlowSettingsDialog', () => {
  let component: FlowSettingsDialog;
  let fixture: ComponentFixture<FlowSettingsDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestModule, FlowSettingsDialog],
    }).compileComponents();

    fixture = TestBed.createComponent(FlowSettingsDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('offers independent grid and compact controls for Box-line and saves them', () => {
    expect(
      fixture.debugElement.query(By.css('[label="flowSettings.gridSnap"]')),
    ).toBeNull();
    component.apply({ diagram: FlowDiagram.BoxLine });
    fixture.detectChanges();
    for (const key of ['gridSnap', 'compactLayout'] as const) {
      const control = fixture.debugElement.query(
        By.css(`[label="flowSettings.${key}"]`),
      );
      control.triggerEventHandler('ngModelChange', true);
      expect(component['editValue']()[key]).toBeTrue();
    }
    const apply = spyOn(component['preferencesStore'], 'apply');
    component.save();
    expect(apply).toHaveBeenCalledWith({
      flowSettings: component['editValue'](),
    });
    component.reset();
    expect(component['editValue']().gridSnap).toBeFalse();
    expect(component['editValue']().compactLayout).toBeFalse();
  });

  describe('apply', () => {
    it('should update the editValue', () => {
      component.apply({ diagram: FlowDiagram.BoxLine });
      expect(component['editValue']().diagram).toEqual(FlowDiagram.BoxLine);
    });
  });

  describe('reset', () => {
    it('should reset the editValue', () => {
      spyOn(component['editValue'], 'set');
      component.reset();
      expect(component['editValue'].set).toHaveBeenCalledWith(
        initialPreferencesState.flowSettings,
      );
    });
  });

  describe('save', () => {
    it('should apply the editValue and close the dialog', () => {
      spyOn(component['preferencesStore'], 'apply');
      spyOn(component['dialogRef'], 'close');
      component.save();
      expect(component['preferencesStore'].apply).toHaveBeenCalled();
      expect(component['dialogRef'].close).toHaveBeenCalled();
    });
  });
});
